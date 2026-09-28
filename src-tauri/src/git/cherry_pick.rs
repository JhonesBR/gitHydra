use serde::Serialize;

use crate::error::GitCommandError;

use super::rebase::{collect_conflicted_files, ConflictedFile};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CherryPickResult {
    pub conflicts: Vec<ConflictedFile>,
}

pub fn cherry_pick(
    repo: &mut git2::Repository,
    sha: &str,
    create_commit: bool,
) -> Result<CherryPickResult, GitCommandError> {
    let oid = git2::Oid::from_str(sha).map_err(|_| GitCommandError::RepoNotFound {
        path: sha.to_string(),
    })?;
    let commit = repo.find_commit(oid)?;

    let mut opts = git2::CherrypickOptions::new();
    repo.cherrypick(&commit, Some(&mut opts))?;

    if repo.index()?.has_conflicts() {
        let conflicts = collect_conflicted_files(repo)?;
        return Ok(CherryPickResult { conflicts });
    }

    if create_commit {
        let tree_id = repo.index()?.write_tree()?;
        let tree = repo.find_tree(tree_id)?;
        let head_commit = repo.head()?.peel_to_commit()?;
        let author = commit.author();
        let committer = repo.signature()?;
        repo.commit(
            Some("HEAD"),
            &author,
            &committer,
            commit.message().unwrap_or(""),
            &tree,
            &[&head_commit],
        )?;
    }

    repo.cleanup_state()?;
    Ok(CherryPickResult {
        conflicts: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn init_repo_with_commit(dir: &std::path::Path) -> git2::Repository {
        let repo = git2::Repository::init(dir).unwrap();
        std::fs::write(dir.join("a.txt"), "hello\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("a.txt")).unwrap();
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
    fn cherry_picks_a_commit_creating_a_new_commit() {
        let tmp = tempfile::tempdir().unwrap();
        let mut repo = init_repo_with_commit(tmp.path());
        let base_sha = repo.head().unwrap().target().unwrap();

        // second commit on top, to be cherry-picked
        std::fs::write(tmp.path().join("b.txt"), "feature\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("b.txt")).unwrap();
        let tree_id = index.write_tree().unwrap();
        index.write().unwrap();
        let sig = git2::Signature::now("Test", "test@example.com").unwrap();
        let feature_sha = {
            let parent = repo.find_commit(base_sha).unwrap();
            let tree = repo.find_tree(tree_id).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "add feature", &tree, &[&parent])
                .unwrap()
        };

        // reset HEAD back to base, so the cherry-pick has something to apply
        {
            let base_commit = repo.find_commit(base_sha).unwrap();
            repo.reset(base_commit.as_object(), git2::ResetType::Hard, None)
                .unwrap();
        }

        let result = cherry_pick(&mut repo, &feature_sha.to_string(), true).unwrap();
        assert_eq!(result.conflicts.len(), 0);
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("b.txt")).unwrap(),
            "feature\n"
        );
        assert_ne!(repo.head().unwrap().target().unwrap(), base_sha);
    }
}
