use serde::Serialize;

use crate::error::GitCommandError;

use super::rebase::{collect_conflicted_files, ConflictedFile};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevertResult {
    /// The new revert commit; `None` when it stopped on conflicts.
    pub sha: Option<String>,
    pub conflicts: Vec<ConflictedFile>,
}

/// Same message `git revert` writes, so the history reads the same whichever
/// tool made the commit.
pub fn revert_message(commit: &git2::Commit, mainline_parent: Option<git2::Oid>) -> String {
    let summary = commit.summary().ok().flatten().unwrap_or_default();
    let mut message = format!("Revert \"{summary}\"\n\nThis reverts commit {}", commit.id());
    if let Some(parent) = mainline_parent {
        message.push_str(&format!(", reversing\nchanges made to {parent}"));
    }
    message.push_str(".\n");
    message
}

/// `git revert [-m <mainline>] <sha>`: applies the inverse of `sha` on top of
/// HEAD and commits it. Merge commits need `mainline` (1-based parent the
/// revert is relative to). On conflicts the repo is left in the revert state
/// (REVERT_HEAD + MERGE_MSG) for the shared conflict panel, then finished by
/// [`continue_revert`] or aborted like a merge.
pub fn revert_commit(
    repo: &git2::Repository,
    sha: &str,
    mainline: Option<u32>,
) -> Result<RevertResult, GitCommandError> {
    if repo.state() != git2::RepositoryState::Clean {
        return Err(GitCommandError::Internal(
            "finish or abort the operation in progress before reverting".into(),
        ));
    }
    let oid = git2::Oid::from_str(sha).map_err(|_| GitCommandError::RepoNotFound {
        path: sha.to_string(),
    })?;
    let commit = repo.find_commit(oid)?;
    let parents = commit.parent_count();
    let mainline = match mainline {
        _ if parents < 2 => None,
        None => {
            return Err(GitCommandError::Internal(
                "this is a merge commit: choose which parent to revert relative to".into(),
            ))
        }
        Some(m) if m == 0 || m as usize > parents => {
            return Err(GitCommandError::Internal(format!(
                "merge commit has no parent {m}"
            )))
        }
        Some(m) => Some(m),
    };
    // The revert commit is written from the index, so anything already
    // staged would silently ride along with it.
    let head_tree = repo.head()?.peel_to_tree()?;
    if repo.diff_tree_to_index(Some(&head_tree), None, None)?.deltas().len() > 0 {
        return Err(GitCommandError::Internal(
            "commit or stash your staged changes before reverting".into(),
        ));
    }

    let mut opts = git2::RevertOptions::new();
    if let Some(m) = mainline {
        opts.mainline(m);
    }
    repo.revert(&commit, Some(&mut opts))?;

    let message = revert_message(&commit, mainline.map(|m| commit.parent_id(m as usize - 1)).transpose()?);
    std::fs::write(repo.path().join("MERGE_MSG"), &message)
        .map_err(|e| GitCommandError::Internal(e.to_string()))?;

    if repo.index()?.has_conflicts() {
        return Ok(RevertResult {
            sha: None,
            conflicts: collect_conflicted_files(repo)?,
        });
    }
    let sha = commit_revert(repo, &message)?;
    Ok(RevertResult {
        sha: Some(sha.to_string()),
        conflicts: Vec::new(),
    })
}

/// Finishes a revert whose conflicts were resolved, with the message
/// `revert_commit` left in MERGE_MSG.
pub fn continue_revert(repo: &git2::Repository) -> Result<git2::Oid, GitCommandError> {
    if repo.index()?.has_conflicts() {
        return Err(GitCommandError::Internal(
            "revert still has unresolved conflicts".into(),
        ));
    }
    let message = repo.message().unwrap_or_else(|_| "Revert".to_string());
    commit_revert(repo, &message)
}

fn commit_revert(repo: &git2::Repository, message: &str) -> Result<git2::Oid, GitCommandError> {
    let tree = repo.find_tree(repo.index()?.write_tree()?)?;
    let head = repo.head()?.peel_to_commit()?;
    if tree.id() == head.tree_id() {
        // Already undone by a later commit: like `git revert`, refuse an empty commit.
        repo.cleanup_state()?;
        return Err(GitCommandError::Internal(
            "nothing to revert: those changes are already undone".into(),
        ));
    }
    let sig = repo.signature()?;
    let oid = repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[&head])?;
    repo.cleanup_state()?;
    Ok(oid)
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
        let parents: Vec<_> = repo
            .head()
            .ok()
            .and_then(|h| h.target())
            .and_then(|oid| repo.find_commit(oid).ok())
            .into_iter()
            .collect();
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
        let tree = repo.find_tree(tree_id).unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &parent_refs)
            .unwrap()
    }

    /// Committed content, not the working copy: checkouts on a machine with
    /// core.autocrlf=true write CRLF to disk.
    fn head_blob(repo: &git2::Repository, file: &str) -> Option<String> {
        let tree = repo.head().unwrap().peel_to_tree().unwrap();
        let entry = tree.get_path(Path::new(file)).ok()?;
        let blob = repo.find_blob(entry.id()).unwrap();
        Some(String::from_utf8_lossy(blob.content()).into_owned())
    }

    #[test]
    fn reverts_a_commit_with_gits_message() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        commit_file(&repo, "a.txt", "one\n", "base");
        let target = commit_file(&repo, "a.txt", "one\ntwo\n", "add two");
        commit_file(&repo, "b.txt", "other\n", "unrelated");

        let result = revert_commit(&repo, &target.to_string(), None).unwrap();
        assert!(result.conflicts.is_empty());
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(result.sha, Some(head.id().to_string()));
        assert_eq!(
            head.message().unwrap(),
            format!("Revert \"add two\"\n\nThis reverts commit {target}.\n")
        );
        assert_eq!(head_blob(&repo, "a.txt").as_deref(), Some("one\n"));
        assert_eq!(head_blob(&repo, "b.txt").as_deref(), Some("other\n"));
        assert_eq!(repo.state(), git2::RepositoryState::Clean);
    }

    #[test]
    fn conflicting_revert_stops_in_revert_state_until_continued() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        commit_file(&repo, "a.txt", "one\n", "base");
        let target = commit_file(&repo, "a.txt", "two\n", "change to two");
        commit_file(&repo, "a.txt", "three\n", "change to three");

        let result = revert_commit(&repo, &target.to_string(), None).unwrap();
        assert_eq!(result.sha, None);
        assert_eq!(result.conflicts.len(), 1);
        assert_eq!(result.conflicts[0].path, "a.txt");
        assert_eq!(repo.state(), git2::RepositoryState::Revert);

        // A second revert can't start on top of this one.
        assert!(revert_commit(&repo, &target.to_string(), None).is_err());

        super::super::rebase::resolve_conflict(
            &repo,
            "a.txt",
            super::super::rebase::ConflictResolution::UseManualContent("one\n".into()),
        )
        .unwrap();
        continue_revert(&repo).unwrap();
        assert_eq!(repo.state(), git2::RepositoryState::Clean);
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert!(head.message().unwrap().starts_with("Revert \"change to two\""));
        assert_eq!(head_blob(&repo, "a.txt").as_deref(), Some("one\n"));
    }

    #[test]
    fn merge_commits_need_a_mainline_parent() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        let base = commit_file(&repo, "a.txt", "one\n", "base");
        let main = repo.head().unwrap().shorthand().unwrap().to_string();
        repo.branch("feature", &repo.find_commit(base).unwrap(), false).unwrap();
        repo.set_head("refs/heads/feature").unwrap();
        commit_file(&repo, "b.txt", "feature\n", "feature work");
        repo.set_head(&format!("refs/heads/{main}")).unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force())).unwrap();
        crate::git::merge::merge_branch(&repo, "feature").unwrap();
        let merge = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(merge.parent_count(), 2);

        assert!(revert_commit(&repo, &merge.id().to_string(), None).is_err());
        assert!(revert_commit(&repo, &merge.id().to_string(), Some(3)).is_err());

        let result = revert_commit(&repo, &merge.id().to_string(), Some(1)).unwrap();
        assert!(result.conflicts.is_empty());
        assert_eq!(head_blob(&repo, "b.txt"), None);
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert!(head
            .message()
            .unwrap()
            .ends_with(&format!(", reversing\nchanges made to {base}.\n")));
    }

    #[test]
    fn refuses_to_revert_with_staged_changes() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        commit_file(&repo, "a.txt", "one\n", "base");
        let target = commit_file(&repo, "a.txt", "one\ntwo\n", "add two");
        std::fs::write(tmp.path().join("c.txt"), "staged\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("c.txt")).unwrap();
        index.write().unwrap();

        assert!(revert_commit(&repo, &target.to_string(), None).is_err());
        assert_eq!(repo.head().unwrap().target().unwrap(), target);
    }
}
