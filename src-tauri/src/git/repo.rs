use serde::Serialize;

use crate::error::GitCommandError;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSummary {
    pub repo_id: String,
    pub path: String,
    pub is_bare: bool,
    pub current_branch: Option<String>,
    pub head_sha: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    pub current_branch: Option<String>,
    pub head_detached: bool,
    pub dirty_files: u32,
    pub staged_files: u32,
    pub ahead: u32,
    pub behind: u32,
    pub in_progress_op: Option<InProgressOp>,
}

#[derive(Debug, Serialize)]
pub enum InProgressOp {
    Rebase,
    Merge,
    CherryPick,
    Revert,
}

impl InProgressOp {
    fn from_state(state: git2::RepositoryState) -> Option<Self> {
        use git2::RepositoryState::*;
        match state {
            Clean => None,
            Rebase | RebaseInteractive | RebaseMerge => Some(InProgressOp::Rebase),
            Merge => Some(InProgressOp::Merge),
            CherryPick | CherryPickSequence => Some(InProgressOp::CherryPick),
            Revert | RevertSequence => Some(InProgressOp::Revert),
            _ => None,
        }
    }
}

fn current_branch_name(repo: &git2::Repository) -> Option<String> {
    let head = repo.head().ok()?;
    head.shorthand().ok().map(str::to_string)
}

pub fn open(path: &str) -> Result<git2::Repository, GitCommandError> {
    git2::Repository::discover(path).map_err(|_| GitCommandError::RepoNotFound {
        path: path.to_string(),
    })
}

pub fn summary(repo_id: String, path: String, repo: &git2::Repository) -> RepoSummary {
    let head_sha = repo
        .head()
        .ok()
        .and_then(|h| h.target())
        .map(|oid| oid.to_string());

    RepoSummary {
        repo_id,
        path,
        is_bare: repo.is_bare(),
        current_branch: current_branch_name(repo),
        head_sha,
    }
}

pub fn status(repo: &git2::Repository) -> Result<RepoStatus, GitCommandError> {
    let mut dirty_files = 0u32;
    let mut staged_files = 0u32;
    for entry in repo.statuses(None)?.iter() {
        let s = entry.status();
        if s.intersects(
            git2::Status::INDEX_NEW
                | git2::Status::INDEX_MODIFIED
                | git2::Status::INDEX_DELETED
                | git2::Status::INDEX_RENAMED
                | git2::Status::INDEX_TYPECHANGE,
        ) {
            staged_files += 1;
        }
        if s.intersects(
            git2::Status::WT_NEW
                | git2::Status::WT_MODIFIED
                | git2::Status::WT_DELETED
                | git2::Status::WT_RENAMED
                | git2::Status::WT_TYPECHANGE,
        ) {
            dirty_files += 1;
        }
    }

    let (ahead, behind) = ahead_behind(repo).unwrap_or((0, 0));

    Ok(RepoStatus {
        current_branch: current_branch_name(repo),
        head_detached: repo.head_detached().unwrap_or(false),
        dirty_files,
        staged_files,
        ahead,
        behind,
        in_progress_op: InProgressOp::from_state(repo.state()),
    })
}

fn ahead_behind(repo: &git2::Repository) -> Option<(u32, u32)> {
    let head = repo.head().ok()?;
    let local_oid = head.target()?;
    let branch = git2::Branch::wrap(head);
    let upstream = branch.upstream().ok()?;
    let upstream_oid = upstream.get().target()?;
    let (ahead, behind) = repo.graph_ahead_behind(local_oid, upstream_oid).ok()?;
    Some((ahead as u32, behind as u32))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn init_repo_with_commit(dir: &std::path::Path) -> git2::Repository {
        let repo = git2::Repository::init(dir).unwrap();
        fs::write(dir.join("a.txt"), "hello").unwrap();
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
    fn status_reports_clean_repo_with_head() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = init_repo_with_commit(tmp.path());

        let status = status(&repo).unwrap();
        assert!(status.current_branch.is_some());
        assert_eq!(status.dirty_files, 0);
        assert_eq!(status.staged_files, 0);
        assert!(status.in_progress_op.is_none());
    }

    #[test]
    fn status_counts_dirty_and_staged_files() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = init_repo_with_commit(tmp.path());

        fs::write(tmp.path().join("a.txt"), "changed").unwrap();
        fs::write(tmp.path().join("b.txt"), "new file").unwrap();
        let mut index = repo.index().unwrap();
        index
            .add_path(std::path::Path::new("b.txt"))
            .unwrap();
        index.write().unwrap();

        let status = status(&repo).unwrap();
        assert_eq!(status.dirty_files, 1); // a.txt modified in working dir
        assert_eq!(status.staged_files, 1); // b.txt staged as new
    }
}
