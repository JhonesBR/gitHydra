use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::error::GitCommandError;
use crate::{passphrase, ssh_keys};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchSummary {
    pub remote_name: String,
    pub received_objects: usize,
    pub total_objects: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushSummary {
    pub remote_name: String,
    pub branch: String,
}

pub fn fetch(
    repo: &git2::Repository,
    remote_name: &str,
    mode: AuthMode,
    mut on_progress: impl FnMut(
            /* received_objects */ usize,
            /* total_objects */ usize,
            /* received_bytes */ usize,
        ) + 'static,
) -> Result<FetchSummary, GitCommandError> {
    let mut remote = repo.find_remote(remote_name)?;
    let Auth { mut callbacks, locked } = Auth::new(repo, mode);
    callbacks.transfer_progress(move |progress| {
        on_progress(
            progress.received_objects(),
            progress.total_objects(),
            progress.received_bytes(),
        );
        true
    });

    let mut opts = git2::FetchOptions::new();
    opts.remote_callbacks(callbacks);
    remote
        .fetch(&[] as &[&str], Some(&mut opts), None)
        .map_err(|e| Auth::error(&locked, e))?;

    let stats = remote.stats();
    Ok(FetchSummary {
        remote_name: remote_name.to_string(),
        received_objects: stats.received_objects(),
        total_objects: stats.total_objects(),
    })
}

/// Raw URL configured for a remote (e.g. `git@host:owner/repo.git` or
/// `https://host/owner/repo.git`), used to identify which code-hosting
/// provider/instance a repo's `origin` points at. `None` if the remote has no
/// URL configured (unusual, but `git2` allows it).
pub fn get_remote_url(
    repo: &git2::Repository,
    remote_name: &str,
) -> Result<Option<String>, GitCommandError> {
    let remote = repo.find_remote(remote_name)?;
    let url = remote.url()?;
    Ok(if url.is_empty() {
        None
    } else {
        Some(url.to_string())
    })
}

pub fn push(
    repo: &git2::Repository,
    remote_name: &str,
    branch: &str,
    force: bool,
    mut on_progress: impl FnMut(/* current */ u32, /* total */ u32, /* bytes */ usize) + 'static,
) -> Result<PushSummary, GitCommandError> {
    let mut remote = repo.find_remote(remote_name)?;
    let Auth { mut callbacks, .. } = Auth::new(repo, AuthMode::Interactive);
    callbacks.push_transfer_progress(move |current, total, bytes| {
        on_progress(current as u32, total as u32, bytes);
    });

    let rejected: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let rejected_cb = rejected.clone();
    callbacks.push_update_reference(move |refname, status| {
        if let Some(message) = status {
            *rejected_cb.lock().unwrap() = Some(format!("{refname}: {message}"));
        }
        Ok(())
    });

    let mut opts = git2::PushOptions::new();
    opts.remote_callbacks(callbacks);

    let refspec = if force {
        format!("+refs/heads/{branch}:refs/heads/{branch}")
    } else {
        format!("refs/heads/{branch}:refs/heads/{branch}")
    };
    // Local/file transports (used by our own tests, and by anyone pushing to
    // a bare repo on disk) reject non-fast-forwards synchronously here; smart
    // HTTP/SSH remotes instead report it asynchronously via the
    // `push_update_reference` callback below, hence checking both spots.
    if let Err(e) = remote.push(&[refspec.as_str()], Some(&mut opts)) {
        if e.code() == git2::ErrorCode::NotFastForward {
            return Err(GitCommandError::PushRejectedNonFastForward {
                message: e.message().to_string(),
            });
        }
        return Err(e.into());
    }

    if let Some(message) = rejected.lock().unwrap().take() {
        let is_non_fast_forward = ["non-fast-forward", "fetch first", "stale info"]
            .iter()
            .any(|needle| message.contains(needle));
        if is_non_fast_forward {
            return Err(GitCommandError::PushRejectedNonFastForward { message });
        }
        return Err(GitCommandError::Internal(format!(
            "push rejected by server: {message}"
        )));
    }

    Ok(PushSummary {
        remote_name: remote_name.to_string(),
        branch: branch.to_string(),
    })
}

/// Deletes `branch` on `remote_name` via an empty-source refspec (the git
/// protocol's delete form), then best-effort drops the local remote-tracking
/// ref (`refs/remotes/{remote}/{branch}`) too, so the UI stops showing this
/// branch as present on the remote without needing a fetch first.
pub fn delete_remote_branch(
    repo: &git2::Repository,
    remote_name: &str,
    branch: &str,
) -> Result<(), GitCommandError> {
    push_refspec(repo, remote_name, &format!(":refs/heads/{branch}"))?;
    if let Ok(mut tracking_ref) =
        repo.find_reference(&format!("refs/remotes/{remote_name}/{branch}"))
    {
        let _ = tracking_ref.delete();
    }
    Ok(())
}

/// Pushes a single refspec, surfacing server-side rejections as errors.
fn push_refspec(
    repo: &git2::Repository,
    remote_name: &str,
    refspec: &str,
) -> Result<(), GitCommandError> {
    let mut remote = repo.find_remote(remote_name)?;
    let Auth { mut callbacks, .. } = Auth::new(repo, AuthMode::Interactive);

    let rejected: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let rejected_cb = rejected.clone();
    callbacks.push_update_reference(move |refname, status| {
        if let Some(message) = status {
            *rejected_cb.lock().unwrap() = Some(format!("{refname}: {message}"));
        }
        Ok(())
    });

    let mut opts = git2::PushOptions::new();
    opts.remote_callbacks(callbacks);
    remote.push(&[refspec], Some(&mut opts))?;

    if let Some(message) = rejected.lock().unwrap().take() {
        return Err(GitCommandError::Internal(format!(
            "push rejected by server: {message}"
        )));
    }
    Ok(())
}

pub fn push_tag(repo: &git2::Repository, remote_name: &str, tag: &str) -> Result<(), GitCommandError> {
    push_refspec(repo, remote_name, &format!("refs/tags/{tag}:refs/tags/{tag}"))
}

pub fn delete_remote_tag(
    repo: &git2::Repository,
    remote_name: &str,
    tag: &str,
) -> Result<(), GitCommandError> {
    push_refspec(repo, remote_name, &format!(":refs/tags/{tag}"))
}

/// Names of the tags that exist on the remote (like `git ls-remote --tags`).
/// Looked up on its own while the UI renders, so it never prompts.
pub fn list_remote_tags(
    repo: &git2::Repository,
    remote_name: &str,
) -> Result<Vec<String>, GitCommandError> {
    let mut remote = repo.find_remote(remote_name)?;
    let Auth { callbacks, locked } = Auth::new(repo, AuthMode::Background);
    let conn = remote
        .connect_auth(git2::Direction::Fetch, Some(callbacks), None)
        .map_err(|e| Auth::error(&locked, e))?;
    let tags = conn
        .list()?
        .iter()
        .filter_map(|h| h.name().strip_prefix("refs/tags/"))
        .filter(|n| !n.ends_with("^{}"))
        .map(String::from)
        .collect();
    Ok(tags)
}

/// Whether a remote operation may stop to ask the user for an SSH key
/// passphrase. Background ones (launch / on-open fetches, remote tag lookups)
/// only use passphrases already given this session and otherwise fail with
/// `SshPassphraseRequired`, waiting for an operation the user asked for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthMode {
    Interactive,
    Background,
}

/// Steps through the candidate keys, one per credentials callback — libgit2
/// re-invokes it after the server rejects the previous credential.
struct KeyPicker {
    keys: Vec<(PathBuf, Option<PathBuf>)>,
    next: usize,
    mode: AuthMode,
    /// Encrypted key skipped because Background mode can't ask for its passphrase.
    locked: Option<PathBuf>,
}

impl KeyPicker {
    fn new(keys: Vec<(PathBuf, Option<PathBuf>)>, mode: AuthMode) -> Self {
        Self { keys, next: 0, mode, locked: None }
    }

    /// Next (private key, public key, passphrase) to offer, if any.
    fn next(
        &mut self,
        is_encrypted: impl Fn(&Path) -> bool,
        passphrase: impl Fn(&Path, AuthMode) -> Option<String>,
    ) -> Option<(PathBuf, Option<PathBuf>, Option<String>)> {
        while let Some((private_key, public_key)) = self.keys.get(self.next).cloned() {
            self.next += 1;
            if !is_encrypted(&private_key) {
                return Some((private_key, public_key, None));
            }
            match passphrase(&private_key, self.mode) {
                Some(p) => return Some((private_key, public_key, Some(p))),
                None if self.mode == AuthMode::Background => self.locked = Some(private_key),
                None => {} // the user cancelled the prompt
            }
        }
        None
    }
}

fn session_passphrase(key: &Path, mode: AuthMode) -> Option<String> {
    match mode {
        AuthMode::Interactive => passphrase::get(key),
        AuthMode::Background => passphrase::cached(key),
    }
}

/// Credential callbacks plus what they learned, to explain a failure.
struct Auth {
    callbacks: git2::RemoteCallbacks<'static>,
    locked: Arc<Mutex<Option<PathBuf>>>,
}

impl Auth {
    /// The repo's SSH key (see `ssh_keys`) — tried after ssh-agent — then
    /// whatever git's own credential helper / netrc has for HTTPS.
    fn new(repo: &git2::Repository, mode: AuthMode) -> Self {
        let repo_dir = repo.workdir().unwrap_or(repo.path());
        let mut picker = KeyPicker::new(ssh_keys::keys_for(Some(repo_dir)), mode);
        let locked = Arc::new(Mutex::new(None));
        let locked_cb = locked.clone();
        let mut agent_tried = false;
        let mut last_encrypted: Option<PathBuf> = None;

        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(move |url, username_from_url, allowed| {
            let username = username_from_url.unwrap_or("git");

            if allowed.contains(git2::CredentialType::SSH_KEY) {
                // Re-invoked means the previous credential failed the handshake;
                // if it used a passphrase, that one may be wrong — ask again next time.
                if let Some(key) = last_encrypted.take() {
                    passphrase::forget(&key);
                }
                if !agent_tried {
                    agent_tried = true;
                    if let Ok(cred) = git2::Cred::ssh_key_from_agent(username) {
                        return Ok(cred);
                    }
                }
                while let Some((private_key, public_key, pass)) =
                    picker.next(passphrase::is_encrypted, session_passphrase)
                {
                    if let Ok(cred) = git2::Cred::ssh_key(
                        username,
                        public_key.as_deref(),
                        &private_key,
                        pass.as_deref(),
                    ) {
                        if pass.is_some() {
                            last_encrypted = Some(private_key);
                        }
                        return Ok(cred);
                    }
                }
                *locked_cb.lock().unwrap() = picker.locked.clone();
            }

            if allowed.contains(git2::CredentialType::DEFAULT) {
                if let Ok(cred) = git2::Cred::default() {
                    return Ok(cred);
                }
            }

            Err(git2::Error::from_str(&format!(
                "no credentials available for {url}"
            )))
        });
        Self { callbacks, locked }
    }

    fn error(locked: &Mutex<Option<PathBuf>>, e: git2::Error) -> GitCommandError {
        match locked.lock().unwrap().take() {
            Some(key) => GitCommandError::SshPassphraseRequired {
                key: key.display().to_string(),
            },
            None => e.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn commit_file(repo: &git2::Repository, file: &str, content: &str, msg: &str) -> git2::Oid {
        std::fs::write(repo.workdir().unwrap().join(file), content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(file)).unwrap();
        let tree_id = index.write_tree().unwrap();
        index.write().unwrap();

        let sig = git2::Signature::now("Test", "test@example.com").unwrap();
        let parent = repo
            .head()
            .ok()
            .and_then(|h| h.target())
            .and_then(|oid| repo.find_commit(oid).ok());
        let parents: Vec<_> = parent.into_iter().collect();
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
        let tree = repo.find_tree(tree_id).unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &parent_refs)
            .unwrap()
    }

    #[test]
    fn pushes_to_and_fetches_from_a_local_bare_remote() {
        let bare_dir = tempfile::tempdir().unwrap();
        git2::Repository::init_bare(bare_dir.path()).unwrap();

        let local_dir = tempfile::tempdir().unwrap();
        let local = git2::Repository::init(local_dir.path()).unwrap();
        commit_file(&local, "a.txt", "hello", "initial");
        let branch_name = local.head().unwrap().shorthand().unwrap().to_string();
        local
            .remote("origin", bare_dir.path().to_str().unwrap())
            .unwrap();

        // push: local -> bare "remote"
        let summary = push(&local, "origin", &branch_name, false, |_, _, _| {}).unwrap();
        assert_eq!(summary.branch, branch_name);

        // a second clone fetching from the same bare remote should see the pushed commit
        let other_dir = tempfile::tempdir().unwrap();
        let other = git2::Repository::init(other_dir.path()).unwrap();
        other
            .remote("origin", bare_dir.path().to_str().unwrap())
            .unwrap();
        let fetch_summary = fetch(&other, "origin", AuthMode::Interactive, |_, _, _| {}).unwrap();
        assert!(fetch_summary.received_objects > 0);
        assert!(other
            .find_reference(&format!("refs/remotes/origin/{branch_name}"))
            .is_ok());
    }

    #[test]
    fn non_fast_forward_push_is_rejected_unless_forced() {
        let bare_dir = tempfile::tempdir().unwrap();
        git2::Repository::init_bare(bare_dir.path()).unwrap();

        let local_dir = tempfile::tempdir().unwrap();
        let local = git2::Repository::init(local_dir.path()).unwrap();
        commit_file(&local, "a.txt", "hello", "initial");
        let branch_name = local.head().unwrap().shorthand().unwrap().to_string();
        local
            .remote("origin", bare_dir.path().to_str().unwrap())
            .unwrap();
        push(&local, "origin", &branch_name, false, |_, _, _| {}).unwrap();

        // a second clone fetches, then pushes a commit of its own on top —
        // the bare remote's ref is now ahead of what `local` knows about.
        let other_dir = tempfile::tempdir().unwrap();
        let other = git2::Repository::init(other_dir.path()).unwrap();
        other
            .remote("origin", bare_dir.path().to_str().unwrap())
            .unwrap();
        fetch(&other, "origin", AuthMode::Interactive, |_, _, _| {}).unwrap();
        let remote_commit = other
            .find_reference(&format!("refs/remotes/origin/{branch_name}"))
            .unwrap()
            .peel_to_commit()
            .unwrap();
        other.branch(&branch_name, &remote_commit, false).unwrap();
        other
            .set_head(&format!("refs/heads/{branch_name}"))
            .unwrap();
        other.checkout_head(None).unwrap();
        commit_file(&other, "b.txt", "from-other", "other change");
        push(&other, "origin", &branch_name, false, |_, _, _| {}).unwrap();

        // `local` makes a diverging commit and tries to push without force
        commit_file(&local, "c.txt", "from-local", "diverging change");
        let result = push(&local, "origin", &branch_name, false, |_, _, _| {});
        assert!(
            matches!(
                result,
                Err(GitCommandError::PushRejectedNonFastForward { .. })
            ),
            "expected PushRejectedNonFastForward, got {result:?}"
        );

        // forcing it through succeeds and overwrites the remote's ref
        push(&local, "origin", &branch_name, true, |_, _, _| {}).unwrap();
    }

    fn keys(names: &[&str]) -> Vec<(PathBuf, Option<PathBuf>)> {
        names.iter().map(|n| (PathBuf::from(n), None)).collect()
    }

    #[test]
    fn background_never_prompts_and_reports_the_locked_key() {
        let mut picker = KeyPicker::new(keys(&["/k/locked"]), AuthMode::Background);
        let asked = std::cell::Cell::new(None);
        let next = picker.next(|_| true, |_, mode| {
            asked.set(Some(mode));
            None
        });
        assert_eq!(next, None);
        assert_eq!(asked.get(), Some(AuthMode::Background));
        assert_eq!(picker.locked, Some(PathBuf::from("/k/locked")));
    }

    #[test]
    fn background_uses_a_passphrase_given_earlier() {
        let mut picker = KeyPicker::new(keys(&["/k/locked"]), AuthMode::Background);
        let next = picker.next(|_| true, |_, _| Some("secret".into()));
        assert_eq!(next, Some(("/k/locked".into(), None, Some("secret".into()))));
        assert_eq!(picker.locked, None);
    }

    #[test]
    fn interactive_asks_and_a_cancel_is_not_reported_as_locked() {
        let mut picker = KeyPicker::new(keys(&["/k/locked", "/k/plain"]), AuthMode::Interactive);
        let encrypted = |p: &Path| p == Path::new("/k/locked");
        let next = picker.next(encrypted, |_, mode| {
            assert_eq!(mode, AuthMode::Interactive);
            None
        });
        assert_eq!(next, Some(("/k/plain".into(), None, None)));
        assert_eq!(picker.locked, None);
    }

    #[test]
    fn each_key_is_offered_once() {
        let mut picker = KeyPicker::new(keys(&["/k/a", "/k/b"]), AuthMode::Interactive);
        let mut offered = Vec::new();
        while let Some((key, _, _)) = picker.next(|_| false, |_, _| None) {
            offered.push(key);
        }
        assert_eq!(offered, [PathBuf::from("/k/a"), PathBuf::from("/k/b")]);
    }

    #[test]
    fn background_fetch_works_without_credentials() {
        let bare_dir = tempfile::tempdir().unwrap();
        git2::Repository::init_bare(bare_dir.path()).unwrap();
        let local_dir = tempfile::tempdir().unwrap();
        let local = git2::Repository::init(local_dir.path()).unwrap();
        local.remote("origin", bare_dir.path().to_str().unwrap()).unwrap();
        commit_file(&local, "a.txt", "a", "first");
        let branch = local.head().unwrap().shorthand().unwrap().to_string();
        push(&local, "origin", &branch, false, |_, _, _| {}).unwrap();

        let other_dir = tempfile::tempdir().unwrap();
        let other = git2::Repository::init(other_dir.path()).unwrap();
        other.remote("origin", bare_dir.path().to_str().unwrap()).unwrap();
        fetch(&other, "origin", AuthMode::Background, |_, _, _| {}).unwrap();
        assert!(other.find_reference(&format!("refs/remotes/origin/{branch}")).is_ok());
    }

    #[test]
    fn locked_key_maps_to_passphrase_required() {
        let locked = Mutex::new(Some(PathBuf::from("/k/locked")));
        let err = Auth::error(&locked, git2::Error::from_str("no credentials"));
        assert!(matches!(err, GitCommandError::SshPassphraseRequired { key } if key == "/k/locked"));
        let unlocked = Mutex::new(None);
        let err = Auth::error(&unlocked, git2::Error::from_str("no credentials"));
        assert!(matches!(err, GitCommandError::Libgit2 { .. }));
    }
}
