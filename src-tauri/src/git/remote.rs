use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::error::GitCommandError;
use crate::passphrase;

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
    mut on_progress: impl FnMut(
            /* received_objects */ usize,
            /* total_objects */ usize,
            /* received_bytes */ usize,
        ) + 'static,
) -> Result<FetchSummary, GitCommandError> {
    let mut remote = repo.find_remote(remote_name)?;
    let mut callbacks = credential_callbacks();
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
    remote.fetch(&[] as &[&str], Some(&mut opts), None)?;

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
    let mut callbacks = credential_callbacks();
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
    let mut callbacks = credential_callbacks();

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
pub fn list_remote_tags(
    repo: &git2::Repository,
    remote_name: &str,
) -> Result<Vec<String>, GitCommandError> {
    let mut remote = repo.find_remote(remote_name)?;
    let conn = remote.connect_auth(git2::Direction::Fetch, Some(credential_callbacks()), None)?;
    let tags = conn
        .list()?
        .iter()
        .filter_map(|h| h.name().strip_prefix("refs/tags/"))
        .filter(|n| !n.ends_with("^{}"))
        .map(String::from)
        .collect();
    Ok(tags)
}

/// Credential chain, tried in order until one works: ssh-agent, then the key
/// files in ~/.ssh (asking the UI for the passphrase of encrypted ones, cached
/// for the app session), then whatever git's own credential helper / netrc
/// has configured for HTTPS.
fn credential_callbacks() -> git2::RemoteCallbacks<'static> {
    let mut callbacks = git2::RemoteCallbacks::new();
    let mut agent_tried = false;
    let mut next_key = 0usize;
    let mut last_encrypted: Option<PathBuf> = None;
    let ssh_keys = discover_ssh_keys();
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
            // Each re-invocation tries the next candidate key on disk — this
            // is how we "discover" which key the server accepts without
            // parsing ~/.ssh/config.
            while let Some((private_key, public_key)) = ssh_keys.get(next_key) {
                next_key += 1;
                let pass = if passphrase::is_encrypted(private_key) {
                    match passphrase::get(private_key) {
                        Some(p) => Some(p),
                        None => continue,
                    }
                } else {
                    None
                };
                if let Ok(cred) =
                    git2::Cred::ssh_key(username, Some(public_key), private_key, pass.as_deref())
                {
                    if pass.is_some() {
                        last_encrypted = Some(private_key.clone());
                    }
                    return Ok(cred);
                }
            }
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
    callbacks
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Every private key in ~/.ssh with a matching `.pub` sibling, common default
/// names first. We don't parse `~/.ssh/config`'s per-host `IdentityFile`, so
/// instead we just try every key on disk until the server accepts one.
fn discover_ssh_keys() -> Vec<(PathBuf, PathBuf)> {
    let Some(ssh_dir) = home_dir().map(|h| h.join(".ssh")) else {
        return Vec::new();
    };

    let mut keys = Vec::new();
    for name in ["id_ed25519", "id_rsa"] {
        let private_key = ssh_dir.join(name);
        let public_key = ssh_dir.join(format!("{name}.pub"));
        if private_key.is_file() && public_key.is_file() {
            keys.push((private_key, public_key));
        }
    }

    let Ok(entries) = std::fs::read_dir(&ssh_dir) else {
        return keys;
    };
    let mut others: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension().is_none()
                && p.file_name().and_then(|n| n.to_str()) != Some("config")
                && p.file_name().and_then(|n| n.to_str()) != Some("known_hosts")
                && p.with_extension("pub").is_file()
                && !keys.iter().any(|(existing, _)| existing == p)
        })
        .collect();
    others.sort();
    for private_key in others {
        let public_key = private_key.with_extension("pub");
        keys.push((private_key, public_key));
    }

    keys
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
        let fetch_summary = fetch(&other, "origin", |_, _, _| {}).unwrap();
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
        fetch(&other, "origin", |_, _, _| {}).unwrap();
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
}
