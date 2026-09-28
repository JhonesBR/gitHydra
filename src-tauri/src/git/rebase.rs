use serde::{Deserialize, Serialize};

use crate::error::GitCommandError;

#[derive(Debug, Serialize)]
pub enum RebaseState {
    Conflicts,
    Complete,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseStatus {
    pub state: RebaseState,
    pub current_step: u32,
    pub total_steps: u32,
    pub conflicts: Vec<ConflictedFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictedFile {
    pub path: String,
    pub ancestor_content: Option<String>,
    pub ours_content: Option<String>,
    pub theirs_content: Option<String>,
    pub is_binary: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", content = "content")]
pub enum ConflictResolution {
    UseOurs,
    UseTheirs,
    UseManualContent(String),
}

pub fn start<'repo>(
    repo: &'repo git2::Repository,
    onto_branch: &str,
) -> Result<(git2::Rebase<'repo>, RebaseStatus), GitCommandError> {
    let onto_ref = repo.resolve_reference_from_short_name(onto_branch)?;
    let onto = repo.reference_to_annotated_commit(&onto_ref)?;
    let mut rebase = repo.rebase(None, None, Some(&onto), None)?;
    let status = advance(repo, &mut rebase, false)?;
    Ok((rebase, status))
}

const AUTOSTASH_MARKER: &str = "GK_REBASE_AUTOSTASH";

fn autostash_marker_path(repo: &git2::Repository) -> std::path::PathBuf {
    repo.path().join(AUTOSTASH_MARKER)
}

/// Stashes uncommitted changes before a rebase starts (mirroring `git rebase
/// --autostash`, which libgit2 doesn't implement natively) and remembers the
/// stash's sha in a marker file so it can be restored once the rebase is
/// done, even across the multiple separate IPC calls (start/continue/abort)
/// a single rebase spans.
pub fn autostash(repo: &mut git2::Repository) -> Result<(), GitCommandError> {
    let info = super::stash::save(repo, Some("gk-clone: rebase autostash"), false)?;
    std::fs::write(autostash_marker_path(repo), &info.sha)
        .map_err(|e| GitCommandError::Internal(e.to_string()))?;
    Ok(())
}

/// Restores the autostash created by `autostash`, if any, once the rebase
/// that triggered it is done (completed or aborted). Looks the stash up by
/// sha rather than assuming index 0, in case other stashes were created in
/// the meantime. Returns any conflicts from re-applying it — rare, but
/// possible if the rebase itself touched the same lines.
pub fn pop_autostash_if_any(
    repo: &mut git2::Repository,
) -> Result<Vec<ConflictedFile>, GitCommandError> {
    let marker = autostash_marker_path(repo);
    let Ok(sha) = std::fs::read_to_string(&marker) else {
        return Ok(Vec::new());
    };
    let _ = std::fs::remove_file(&marker);

    let stashes = super::stash::list(repo)?;
    let Some(found) = stashes.iter().find(|s| s.sha == sha.trim()) else {
        return Ok(Vec::new());
    };
    let result = super::stash::pop(repo, found.index)?;
    Ok(result.conflicts)
}

pub fn has_uncommitted_changes(repo: &git2::Repository) -> Result<bool, GitCommandError> {
    let dirty = git2::Status::WT_NEW
        | git2::Status::WT_MODIFIED
        | git2::Status::WT_DELETED
        | git2::Status::WT_TYPECHANGE
        | git2::Status::WT_RENAMED
        | git2::Status::INDEX_NEW
        | git2::Status::INDEX_MODIFIED
        | git2::Status::INDEX_DELETED
        | git2::Status::INDEX_TYPECHANGE
        | git2::Status::INDEX_RENAMED;
    Ok(repo
        .statuses(None)?
        .iter()
        .any(|entry| entry.status().intersects(dirty)))
}

/// Applies rebase operations one after another, committing each clean step,
/// until either a conflict blocks progress or the rebase finishes.
/// `commit_pending` should be true when resuming after conflicts on the
/// current step were just resolved (that step still needs to be committed).
pub fn advance(
    repo: &git2::Repository,
    rebase: &mut git2::Rebase,
    commit_pending: bool,
) -> Result<RebaseStatus, GitCommandError> {
    let sig = repo.signature()?;
    if commit_pending {
        rebase.commit(None, &sig, None)?;
    }

    loop {
        match rebase.next() {
            None => {
                rebase.finish(Some(&sig))?;
                return Ok(RebaseStatus {
                    state: RebaseState::Complete,
                    current_step: rebase.len() as u32,
                    total_steps: rebase.len() as u32,
                    conflicts: Vec::new(),
                });
            }
            Some(op) => {
                op?;
                if repo.index()?.has_conflicts() {
                    return conflict_status(repo, rebase);
                }
                rebase.commit(None, &sig, None)?;
            }
        }
    }
}

pub fn resolve_conflict(
    repo: &git2::Repository,
    path: &str,
    resolution: ConflictResolution,
) -> Result<(), GitCommandError> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| GitCommandError::Internal("bare repository does not support checkout".into()))?;
    let full_path = workdir.join(path);
    let mut index = repo.index()?;

    let conflict = index
        .conflicts()?
        .filter_map(|c| c.ok())
        .find(|c| entry_path(c) == Some(path))
        .ok_or_else(|| GitCommandError::Internal(format!("no conflict at {path}")))?;

    let side = match resolution {
        ConflictResolution::UseOurs => conflict.our,
        ConflictResolution::UseTheirs => conflict.their,
        ConflictResolution::UseManualContent(content) => {
            std::fs::write(&full_path, content)
                .map_err(|e| GitCommandError::Internal(e.to_string()))?;
            index.add_path(std::path::Path::new(path))?;
            index.write()?;
            return Ok(());
        }
    };

    match side {
        Some(entry) => {
            let blob = repo.find_blob(entry.id)?;
            std::fs::write(&full_path, blob.content())
                .map_err(|e| GitCommandError::Internal(e.to_string()))?;
            index.add_path(std::path::Path::new(path))?;
        }
        None => {
            let _ = std::fs::remove_file(&full_path);
            index.remove_path(std::path::Path::new(path))?;
        }
    }
    index.write()?;
    Ok(())
}

pub fn abort(rebase: &mut git2::Rebase) -> Result<(), GitCommandError> {
    rebase.abort()?;
    Ok(())
}

pub fn conflict_status(
    repo: &git2::Repository,
    rebase: &mut git2::Rebase,
) -> Result<RebaseStatus, GitCommandError> {
    Ok(RebaseStatus {
        state: RebaseState::Conflicts,
        current_step: rebase.operation_current().unwrap_or(0) as u32,
        total_steps: rebase.len() as u32,
        conflicts: collect_conflicted_files(repo)?,
    })
}

pub fn collect_conflicted_files(
    repo: &git2::Repository,
) -> Result<Vec<ConflictedFile>, GitCommandError> {
    let index = repo.index()?;
    let mut conflicts = Vec::new();
    for conflict in index.conflicts()?.filter_map(|c| c.ok()) {
        let Some(path) = entry_path(&conflict) else {
            continue;
        };
        let is_binary = [&conflict.ancestor, &conflict.our, &conflict.their]
            .iter()
            .filter_map(|e| e.as_ref())
            .filter_map(|e| repo.find_blob(e.id).ok())
            .any(|b| b.is_binary());

        conflicts.push(ConflictedFile {
            path: path.to_string(),
            ancestor_content: read_blob_text(repo, &conflict.ancestor),
            ours_content: read_blob_text(repo, &conflict.our),
            theirs_content: read_blob_text(repo, &conflict.their),
            is_binary,
        });
    }
    Ok(conflicts)
}

fn entry_path(conflict: &git2::IndexConflict) -> Option<&str> {
    [&conflict.our, &conflict.their, &conflict.ancestor]
        .iter()
        .find_map(|e| e.as_ref())
        .and_then(|e| std::str::from_utf8(&e.path).ok())
}

fn read_blob_text(repo: &git2::Repository, entry: &Option<git2::IndexEntry>) -> Option<String> {
    let entry = entry.as_ref()?;
    let blob = repo.find_blob(entry.id).ok()?;
    Some(String::from_utf8_lossy(blob.content()).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::branch;
    use std::path::Path;

    fn commit_file(repo: &git2::Repository, content: &str, msg: &str) -> git2::Oid {
        std::fs::write(repo.workdir().unwrap().join("file.txt"), content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("file.txt")).unwrap();
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
    fn rebases_cleanly_when_no_conflicts() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        commit_file(&repo, "line1\n", "base");
        let base_branch = repo.head().unwrap().shorthand().unwrap().to_string();
        let base_commit = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature", &base_commit, false).unwrap();

        std::fs::write(tmp.path().join("other.txt"), "x").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("other.txt")).unwrap();
        let tree_id = index.write_tree().unwrap();
        index.write().unwrap();
        let sig = git2::Signature::now("Test", "test@example.com").unwrap();
        {
            let parent = base_commit;
            let tree = repo.find_tree(tree_id).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "main change", &tree, &[&parent])
                .unwrap();
        }

        branch::checkout_branch(&repo, "feature").unwrap();
        commit_file(&repo, "line1\nfeature change\n", "feature change");

        let (_session, status) = start(&repo, &base_branch).unwrap();
        assert!(matches!(status.state, RebaseState::Complete));
    }

    #[test]
    fn rebase_stops_on_conflict_and_resolves_with_theirs() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        commit_file(&repo, "line1\n", "base");
        let base_branch = repo.head().unwrap().shorthand().unwrap().to_string();
        let base_commit = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature", &base_commit, false).unwrap();

        commit_file(&repo, "line1\nfrom-main\n", "main change");

        branch::checkout_branch(&repo, "feature").unwrap();
        commit_file(&repo, "line1\nfrom-feature\n", "feature change");

        let (mut session, status) = start(&repo, &base_branch).unwrap();
        assert!(matches!(status.state, RebaseState::Conflicts));
        assert_eq!(status.conflicts.len(), 1);
        assert_eq!(status.conflicts[0].path, "file.txt");

        resolve_conflict(&repo, "file.txt", ConflictResolution::UseTheirs).unwrap();
        let final_status = advance(&repo, &mut session, true).unwrap();
        assert!(matches!(final_status.state, RebaseState::Complete));
    }

    #[test]
    fn autostashes_dirty_changes_around_a_clean_rebase() {
        let tmp = tempfile::tempdir().unwrap();
        let mut repo = git2::Repository::init(tmp.path()).unwrap();
        commit_file(&repo, "line1\n", "base");
        let base_branch = repo.head().unwrap().shorthand().unwrap().to_string();
        let base_commit = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature", &base_commit, false).unwrap();

        std::fs::write(tmp.path().join("other.txt"), "x").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("other.txt")).unwrap();
        let tree_id = index.write_tree().unwrap();
        index.write().unwrap();
        let sig = git2::Signature::now("Test", "test@example.com").unwrap();
        {
            let parent = base_commit;
            let tree = repo.find_tree(tree_id).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "main change", &tree, &[&parent])
                .unwrap();
        }

        branch::checkout_branch(&repo, "feature").unwrap();
        commit_file(&repo, "line1\nfeature change\n", "feature change");

        // dirty, uncommitted change sitting in the workdir when the rebase starts
        std::fs::write(tmp.path().join("file.txt"), "line1\nfeature change\nuncommitted\n").unwrap();
        assert!(has_uncommitted_changes(&repo).unwrap());
        autostash(&mut repo).unwrap();
        assert!(!has_uncommitted_changes(&repo).unwrap());

        let status = {
            let (_session, status) = start(&repo, &base_branch).unwrap();
            status
        };
        assert!(matches!(status.state, RebaseState::Complete));

        let conflicts = pop_autostash_if_any(&mut repo).unwrap();
        assert_eq!(conflicts.len(), 0);
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("file.txt")).unwrap(),
            "line1\nfeature change\nuncommitted\n"
        );
        // the marker is one-shot — restoring twice must be a no-op, not double-pop
        assert_eq!(pop_autostash_if_any(&mut repo).unwrap().len(), 0);
    }
}
