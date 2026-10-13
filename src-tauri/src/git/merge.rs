use serde::Serialize;

use crate::error::GitCommandError;

use super::rebase::{collect_conflicted_files, ConflictedFile};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResult {
    pub conflicts: Vec<ConflictedFile>,
}

/// Merges `branch_name` into the currently checked-out branch, always
/// creating a merge commit (never fast-forwarding) — the right-click "Merge
/// into current branch" action always promises a commit named
/// `Merge branch '<branch_name>' into '<current>'`.
///
/// On conflicts, leaves the repository in `RepositoryState::Merge` (MERGE_HEAD
/// + our custom MERGE_MSG on disk) for [`continue_merge`]/[`abort_merge`] to
/// pick up later — the same conflict list/resolve machinery rebase conflicts
/// already use, since those don't care what produced the conflicted index.
pub fn merge_branch(
    repo: &git2::Repository,
    branch_name: &str,
) -> Result<MergeResult, GitCommandError> {
    let their_ref = repo.resolve_reference_from_short_name(branch_name)?;
    let their_commit = their_ref.peel_to_commit()?;
    let their_annotated = repo.reference_to_annotated_commit(&their_ref)?;
    let head_name = repo.head()?.shorthand()?.to_string();

    repo.merge(&[&their_annotated], None, None)?;

    let message = format!("Merge branch '{branch_name}' into '{head_name}'");
    std::fs::write(repo.path().join("MERGE_MSG"), format!("{message}\n"))
        .map_err(|e| GitCommandError::Internal(e.to_string()))?;

    if repo.index()?.has_conflicts() {
        return Ok(MergeResult {
            conflicts: collect_conflicted_files(repo)?,
        });
    }

    finish_merge_commit(repo, &their_commit, &message)?;
    Ok(MergeResult {
        conflicts: Vec::new(),
    })
}

fn finish_merge_commit(
    repo: &git2::Repository,
    their_commit: &git2::Commit,
    message: &str,
) -> Result<(), GitCommandError> {
    let tree_id = repo.index()?.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let head_commit = repo.head()?.peel_to_commit()?;
    let sig = repo.signature()?;
    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        message,
        &tree,
        &[&head_commit, their_commit],
    )?;
    repo.cleanup_state()?;
    Ok(())
}

/// Finishes a merge whose conflicts were just resolved (the index no longer
/// reports any), creating the same two-parent commit `merge_branch` would
/// have made directly had it not conflicted.
pub fn continue_merge(repo: &mut git2::Repository) -> Result<(), GitCommandError> {
    if repo.index()?.has_conflicts() {
        return Err(GitCommandError::Internal(
            "merge still has unresolved conflicts".into(),
        ));
    }
    let mut their_oids = Vec::new();
    repo.mergehead_foreach(|oid| {
        their_oids.push(*oid);
        true
    })?;
    let their_oid = *their_oids
        .first()
        .ok_or_else(|| GitCommandError::Internal("no merge in progress".into()))?;
    let their_commit = repo.find_commit(their_oid)?;
    let message = repo
        .message()
        .unwrap_or_else(|_| "Merge commit".to_string());
    finish_merge_commit(repo, &their_commit, message.trim())
}

/// Equivalent to `git merge --abort`: discards the conflicted merge attempt
/// and restores the working directory to HEAD.
pub fn abort_merge(repo: &git2::Repository) -> Result<(), GitCommandError> {
    let head_commit = repo.head()?.peel_to_commit()?;
    repo.reset(head_commit.as_object(), git2::ResetType::Hard, None)?;
    repo.cleanup_state()?;
    Ok(())
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
    fn merges_cleanly_creating_a_merge_commit_with_two_parents() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        commit_file(&repo, "line1\n", "base");
        let base_branch = repo.head().unwrap().shorthand().unwrap().to_string();
        let base_commit = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature", &base_commit, false).unwrap();

        branch::checkout_branch(&repo, "feature").unwrap();
        let feature_sha = commit_file(&repo, "line1\nfeature change\n", "feature change");

        branch::checkout_branch(&repo, &base_branch).unwrap();

        let result = merge_branch(&repo, "feature").unwrap();
        assert_eq!(result.conflicts.len(), 0);

        let head_commit = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(
            head_commit.message().unwrap(),
            format!("Merge branch 'feature' into '{base_branch}'")
        );
        assert_eq!(head_commit.parent_count(), 2);
        assert_eq!(head_commit.parent(0).unwrap().id(), base_commit.id());
        assert_eq!(head_commit.parent(1).unwrap().id(), feature_sha);
        assert_eq!(repo.state(), git2::RepositoryState::Clean);
    }

    #[test]
    fn merge_with_conflicts_leaves_repo_in_merge_state_until_continued() {
        let tmp = tempfile::tempdir().unwrap();
        let mut repo = git2::Repository::init(tmp.path()).unwrap();
        commit_file(&repo, "line1\n", "base");
        let base_branch = repo.head().unwrap().shorthand().unwrap().to_string();
        {
            let base_commit = repo.head().unwrap().peel_to_commit().unwrap();
            repo.branch("feature", &base_commit, false).unwrap();
        }

        branch::checkout_branch(&repo, "feature").unwrap();
        let feature_sha = commit_file(&repo, "line1\nfrom-feature\n", "feature change");

        branch::checkout_branch(&repo, &base_branch).unwrap();
        commit_file(&repo, "line1\nfrom-main\n", "main change");

        let result = merge_branch(&repo, "feature").unwrap();
        assert_eq!(result.conflicts.len(), 1);
        assert_eq!(result.conflicts[0].path, "file.txt");
        assert_eq!(repo.state(), git2::RepositoryState::Merge);

        super::super::rebase::resolve_conflict(
            &repo,
            "file.txt",
            super::super::rebase::ConflictResolution::UseTheirs,
        )
        .unwrap();

        continue_merge(&mut repo).unwrap();
        assert_eq!(repo.state(), git2::RepositoryState::Clean);
        let head_commit = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head_commit.parent_count(), 2);
        assert_eq!(head_commit.parent(1).unwrap().id(), feature_sha);
        assert_eq!(
            head_commit.message().unwrap(),
            format!("Merge branch 'feature' into '{base_branch}'")
        );
    }

    #[test]
    fn abort_merge_restores_head_and_clears_state() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        commit_file(&repo, "line1\n", "base");
        let base_branch = repo.head().unwrap().shorthand().unwrap().to_string();
        let base_commit = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature", &base_commit, false).unwrap();

        branch::checkout_branch(&repo, "feature").unwrap();
        commit_file(&repo, "line1\nfrom-feature\n", "feature change");

        branch::checkout_branch(&repo, &base_branch).unwrap();
        commit_file(&repo, "line1\nfrom-main\n", "main change");

        let result = merge_branch(&repo, "feature").unwrap();
        assert_eq!(result.conflicts.len(), 1);

        abort_merge(&repo).unwrap();
        assert_eq!(repo.state(), git2::RepositoryState::Clean);
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("file.txt")).unwrap(),
            "line1\nfrom-main\n"
        );
    }
}
