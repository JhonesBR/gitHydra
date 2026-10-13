use serde::Serialize;

use crate::error::GitCommandError;

use super::rebase::has_uncommitted_changes;
use super::stash::{self, StashPopResult};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_remote: bool,
    pub is_head: bool,
    pub target_sha: String,
}

pub fn list_branches(repo: &git2::Repository) -> Result<Vec<BranchInfo>, GitCommandError> {
    let head_target = repo.head().ok().and_then(|h| h.target());
    let mut result = Vec::new();
    for entry in repo.branches(None)? {
        let (branch, branch_type) = entry?;
        let is_remote = branch_type == git2::BranchType::Remote;
        if let Some(info) = to_branch_info(branch.into_reference(), is_remote, head_target) {
            result.push(info);
        }
    }
    Ok(result)
}

pub fn create_branch(
    repo: &git2::Repository,
    name: &str,
    start_point: Option<&str>,
    checkout: bool,
) -> Result<BranchInfo, GitCommandError> {
    let target = match start_point {
        Some(sp) => repo.revparse_single(sp)?.peel_to_commit()?,
        None => repo.head()?.peel_to_commit()?,
    };
    let branch = repo.branch(name, &target, false)?;

    if checkout {
        checkout_branch(repo, name)?;
    }

    let head_target = repo.head().ok().and_then(|h| h.target());
    to_branch_info(branch.into_reference(), false, head_target)
        .ok_or_else(|| GitCommandError::Internal("branch created without a valid name".into()))
}

/// Points local branch `name` at `target_sha` (creating it — optionally as a
/// remote tracking branch — if it doesn't exist yet, or moving it if it
/// does) and checks it out. Used for double-clicking a ref pill in the
/// graph: a remote-only ref becomes a new local branch, and re-clicking an
/// existing local branch at a different commit resets it there.
pub fn checkout_at(
    repo: &git2::Repository,
    name: &str,
    target_sha: &str,
    remote_name: Option<&str>,
) -> Result<(), GitCommandError> {
    let oid = git2::Oid::from_str(target_sha).map_err(|_| GitCommandError::RepoNotFound {
        path: target_sha.to_string(),
    })?;
    let commit = repo.find_commit(oid)?;

    match repo.find_branch(name, git2::BranchType::Local) {
        Ok(mut branch) => {
            branch.get_mut().set_target(oid, "gk-clone: reset")?;
        }
        Err(_) => {
            let mut branch = repo.branch(name, &commit, false)?;
            if let Some(remote) = remote_name {
                branch.set_upstream(Some(&format!("{remote}/{name}")))?;
            }
        }
    }

    checkout_branch(repo, name)
}

/// Moves HEAD (and whatever branch it's attached to) to `sha`. `hard` also
/// resets the index and working directory to match; `soft` only moves HEAD,
/// leaving the index/workdir untouched (so the diff between the old and new
/// HEAD shows up as staged changes). The caller is expected to only allow
/// this when the working directory is clean.
pub fn reset_to_commit(
    repo: &git2::Repository,
    sha: &str,
    hard: bool,
) -> Result<(), GitCommandError> {
    let oid = git2::Oid::from_str(sha).map_err(|_| GitCommandError::RepoNotFound {
        path: sha.to_string(),
    })?;
    let object = repo.find_object(oid, None)?;
    let reset_type = if hard {
        git2::ResetType::Hard
    } else {
        git2::ResetType::Soft
    };
    repo.reset(&object, reset_type, None)?;
    Ok(())
}

/// Syncs the currently checked-out branch to `target_sha` (typically its
/// remote-tracking counterpart's tip) without losing uncommitted work:
/// stash (if dirty) → hard reset → re-apply the stash. A clean re-apply
/// drops the stash immediately (mirroring `git stash pop`, implemented as
/// apply + conditional drop since we need to inspect the result first); a
/// conflicted one leaves the stash in place and reports the conflicts for
/// the caller to resolve through the usual conflict machinery.
pub fn sync_branch_to_commit(
    repo: &mut git2::Repository,
    target_sha: &str,
) -> Result<StashPopResult, GitCommandError> {
    let had_changes = has_uncommitted_changes(repo)?;
    let stash_sha = if had_changes {
        Some(stash::save(repo, Some("gk-clone: sync-to-remote autostash"), false)?.sha)
    } else {
        None
    };

    reset_to_commit(repo, target_sha, true)?;

    let Some(stash_sha) = stash_sha else {
        return Ok(StashPopResult {
            conflicts: Vec::new(),
        });
    };

    let stashes = stash::list(repo)?;
    let index = stashes
        .iter()
        .find(|s| s.sha == stash_sha)
        .map(|s| s.index)
        .unwrap_or(0);

    let result = stash::apply(repo, index)?;
    if result.conflicts.is_empty() {
        stash::drop(repo, index)?;
    }
    Ok(result)
}

pub fn checkout_detached(repo: &git2::Repository, sha: &str) -> Result<(), GitCommandError> {
    let oid = git2::Oid::from_str(sha).map_err(|_| GitCommandError::RepoNotFound {
        path: sha.to_string(),
    })?;
    let commit = repo.find_commit(oid)?;
    repo.checkout_tree(commit.as_object(), None)?;
    repo.set_head_detached(oid)?;
    Ok(())
}

/// Deletes a local branch. libgit2 itself refuses to delete the currently
/// checked-out branch, so this is safe to call without a separate guard.
pub fn delete_local_branch(repo: &git2::Repository, name: &str) -> Result<(), GitCommandError> {
    let mut branch = repo.find_branch(name, git2::BranchType::Local)?;
    branch.delete()?;
    Ok(())
}

pub fn checkout_branch(repo: &git2::Repository, name: &str) -> Result<(), GitCommandError> {
    let (object, reference) = repo.revparse_ext(name)?;
    repo.checkout_tree(&object, None)?;
    match reference {
        Some(r) => repo.set_head(r.name().ok().ok_or_else(|| {
            GitCommandError::Internal("branch reference has no utf-8 name".into())
        })?)?,
        None => repo.set_head_detached(object.id())?,
    }
    Ok(())
}

fn to_branch_info(
    reference: git2::Reference,
    is_remote: bool,
    head_target: Option<git2::Oid>,
) -> Option<BranchInfo> {
    let name = reference.shorthand().ok()?.to_string();
    let target = reference.target()?;
    Some(BranchInfo {
        name,
        is_remote,
        is_head: !is_remote && Some(target) == head_target,
        target_sha: target.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn init_repo_with_commit(dir: &std::path::Path) -> git2::Repository {
        let repo = git2::Repository::init(dir).unwrap();
        std::fs::write(dir.join("a.txt"), "hello").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("a.txt")).unwrap();
        let tree_id = index.write_tree().unwrap();
        index.write().unwrap();
        let sig = git2::Signature::now("Test", "test@example.com").unwrap();
        {
            let tree = repo.find_tree(tree_id).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
                .unwrap();
        }
        repo
    }

    #[test]
    fn creates_and_checks_out_a_branch() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = init_repo_with_commit(tmp.path());

        let info = create_branch(&repo, "feature", None, true).unwrap();
        assert_eq!(info.name, "feature");

        let branches = list_branches(&repo).unwrap();
        let feature = branches.iter().find(|b| b.name == "feature").unwrap();
        assert!(feature.is_head);

        let head_name = repo.head().unwrap().shorthand().unwrap().to_string();
        assert_eq!(head_name, "feature");
    }

    #[test]
    fn checkout_at_creates_a_new_local_branch_when_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = init_repo_with_commit(tmp.path());
        let sha = repo.head().unwrap().target().unwrap().to_string();

        checkout_at(&repo, "feature", &sha, None).unwrap();
        assert_eq!(repo.head().unwrap().shorthand().unwrap(), "feature");
    }

    #[test]
    fn checkout_at_resets_an_existing_local_branch_to_a_new_target() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = init_repo_with_commit(tmp.path());
        let first_sha = repo.head().unwrap().target().unwrap();

        std::fs::write(tmp.path().join("b.txt"), "more").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("b.txt")).unwrap();
        let tree_id = index.write_tree().unwrap();
        index.write().unwrap();
        let sig = git2::Signature::now("Test", "test@example.com").unwrap();
        let second_sha = {
            let parent = repo.find_commit(first_sha).unwrap();
            let tree = repo.find_tree(tree_id).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "second", &tree, &[&parent])
                .unwrap()
        };
        let branch_name = repo.head().unwrap().shorthand().unwrap().to_string();

        checkout_at(&repo, &branch_name, &first_sha.to_string(), None).unwrap();
        let branch_ref = repo
            .find_branch(&branch_name, git2::BranchType::Local)
            .unwrap();
        assert_eq!(branch_ref.get().target().unwrap(), first_sha);
        assert_ne!(branch_ref.get().target().unwrap(), second_sha);
    }

    #[test]
    fn soft_reset_moves_head_but_keeps_workdir_and_index() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = init_repo_with_commit(tmp.path());
        let first_sha = repo.head().unwrap().target().unwrap();

        std::fs::write(tmp.path().join("a.txt"), "changed").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("a.txt")).unwrap();
        let tree_id = index.write_tree().unwrap();
        index.write().unwrap();
        let sig = git2::Signature::now("Test", "test@example.com").unwrap();
        let second_sha = {
            let parent = repo.find_commit(first_sha).unwrap();
            let tree = repo.find_tree(tree_id).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "second", &tree, &[&parent])
                .unwrap()
        };

        reset_to_commit(&repo, &first_sha.to_string(), false).unwrap();
        assert_eq!(repo.head().unwrap().target().unwrap(), first_sha);
        assert_ne!(repo.head().unwrap().target().unwrap(), second_sha);
        // soft reset never touches the index or working tree
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("a.txt")).unwrap(),
            "changed"
        );
        let status = repo.statuses(None).unwrap();
        assert!(status
            .iter()
            .any(|e| e.status().contains(git2::Status::INDEX_MODIFIED)));
    }

    #[test]
    fn hard_reset_moves_head_and_discards_workdir_changes() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = init_repo_with_commit(tmp.path());
        let first_sha = repo.head().unwrap().target().unwrap();

        std::fs::write(tmp.path().join("a.txt"), "changed").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("a.txt")).unwrap();
        let tree_id = index.write_tree().unwrap();
        index.write().unwrap();
        let sig = git2::Signature::now("Test", "test@example.com").unwrap();
        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            "second",
            &repo.find_tree(tree_id).unwrap(),
            &[&repo.find_commit(first_sha).unwrap()],
        )
        .unwrap();

        reset_to_commit(&repo, &first_sha.to_string(), true).unwrap();
        assert_eq!(repo.head().unwrap().target().unwrap(), first_sha);
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("a.txt")).unwrap(),
            "hello"
        );
        assert!(!repo.statuses(None).unwrap().iter().any(|e| e
            .status()
            .intersects(git2::Status::INDEX_MODIFIED | git2::Status::WT_MODIFIED)));
    }

    #[test]
    fn sync_branch_to_commit_stashes_resets_and_reapplies_cleanly() {
        let tmp = tempfile::tempdir().unwrap();
        let mut repo = init_repo_with_commit(tmp.path());
        let first_sha = repo.head().unwrap().target().unwrap();

        // Second commit touches a different file than the dirty change below,
        // so the re-applied stash doesn't conflict with it.
        std::fs::write(tmp.path().join("b.txt"), "second").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("b.txt")).unwrap();
        let tree_id = index.write_tree().unwrap();
        index.write().unwrap();
        let sig = git2::Signature::now("Test", "test@example.com").unwrap();
        let second_sha = repo
            .commit(
                Some("HEAD"),
                &sig,
                &sig,
                "second",
                &repo.find_tree(tree_id).unwrap(),
                &[&repo.find_commit(first_sha).unwrap()],
            )
            .unwrap();
        // Simulate "local branch is behind origin": move back to the first commit.
        reset_to_commit(&repo, &first_sha.to_string(), true).unwrap();

        std::fs::write(tmp.path().join("a.txt"), "hello\nlocal edit\n").unwrap();

        let result = sync_branch_to_commit(&mut repo, &second_sha.to_string()).unwrap();
        assert_eq!(result.conflicts.len(), 0);
        assert_eq!(repo.head().unwrap().target().unwrap(), second_sha);
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("a.txt")).unwrap(),
            "hello\nlocal edit\n"
        );
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("b.txt")).unwrap(),
            "second"
        );
        assert_eq!(stash::list(&mut repo).unwrap().len(), 0);
    }

    #[test]
    fn sync_branch_to_commit_reports_conflicts_and_keeps_the_stash() {
        let tmp = tempfile::tempdir().unwrap();
        let mut repo = init_repo_with_commit(tmp.path());
        let first_sha = repo.head().unwrap().target().unwrap();

        // Second commit changes the same file/content the dirty change below
        // also touches, so re-applying the stash conflicts.
        std::fs::write(tmp.path().join("a.txt"), "hello-from-remote").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("a.txt")).unwrap();
        let tree_id = index.write_tree().unwrap();
        index.write().unwrap();
        let sig = git2::Signature::now("Test", "test@example.com").unwrap();
        let second_sha = repo
            .commit(
                Some("HEAD"),
                &sig,
                &sig,
                "second",
                &repo.find_tree(tree_id).unwrap(),
                &[&repo.find_commit(first_sha).unwrap()],
            )
            .unwrap();
        reset_to_commit(&repo, &first_sha.to_string(), true).unwrap();

        std::fs::write(tmp.path().join("a.txt"), "hello-from-local").unwrap();

        let result = sync_branch_to_commit(&mut repo, &second_sha.to_string()).unwrap();
        assert!(!result.conflicts.is_empty());
        assert_eq!(repo.head().unwrap().target().unwrap(), second_sha);
        assert_eq!(stash::list(&mut repo).unwrap().len(), 1);
    }
}
