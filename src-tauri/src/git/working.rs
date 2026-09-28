use serde::Serialize;

use crate::error::GitCommandError;

pub use super::diff::FileStatus;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub status: FileStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingStatus {
    pub staged: Vec<FileEntry>,
    pub unstaged: Vec<FileEntry>,
}

pub fn working_status(repo: &git2::Repository) -> Result<WorkingStatus, GitCommandError> {
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();

    for entry in repo.statuses(None)?.iter() {
        let path = entry.path().unwrap_or_default().to_string();
        let s = entry.status();
        if let Some(status) = index_status(s) {
            staged.push(FileEntry {
                path: path.clone(),
                status,
            });
        }
        if let Some(status) = workdir_status(s) {
            unstaged.push(FileEntry { path, status });
        }
    }

    Ok(WorkingStatus { staged, unstaged })
}

fn index_status(s: git2::Status) -> Option<FileStatus> {
    if s.contains(git2::Status::INDEX_NEW) {
        Some(FileStatus::Added)
    } else if s.contains(git2::Status::INDEX_DELETED) {
        Some(FileStatus::Deleted)
    } else if s.contains(git2::Status::INDEX_RENAMED) {
        Some(FileStatus::Renamed)
    } else if s.contains(git2::Status::INDEX_TYPECHANGE) {
        Some(FileStatus::TypeChange)
    } else if s.contains(git2::Status::INDEX_MODIFIED) {
        Some(FileStatus::Modified)
    } else {
        None
    }
}

fn workdir_status(s: git2::Status) -> Option<FileStatus> {
    if s.contains(git2::Status::WT_NEW) {
        Some(FileStatus::Added)
    } else if s.contains(git2::Status::WT_DELETED) {
        Some(FileStatus::Deleted)
    } else if s.contains(git2::Status::WT_RENAMED) {
        Some(FileStatus::Renamed)
    } else if s.contains(git2::Status::WT_TYPECHANGE) {
        Some(FileStatus::TypeChange)
    } else if s.contains(git2::Status::WT_MODIFIED) {
        Some(FileStatus::Modified)
    } else {
        None
    }
}

pub fn stage_path(repo: &git2::Repository, path: &str) -> Result<(), GitCommandError> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| GitCommandError::Internal("bare repository does not support stage".into()))?;
    let mut index = repo.index()?;
    if workdir.join(path).exists() {
        index.add_path(std::path::Path::new(path))?;
    } else {
        index.remove_path(std::path::Path::new(path))?;
    }
    index.write()?;
    Ok(())
}

pub fn stage_all(repo: &git2::Repository) -> Result<(), GitCommandError> {
    let mut index = repo.index()?;
    index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)?;
    index.update_all(["*"].iter(), None)?;
    index.write()?;
    Ok(())
}

pub fn unstage_path(repo: &git2::Repository, path: &str) -> Result<(), GitCommandError> {
    let head = repo.head()?.peel_to_commit()?;
    repo.reset_default(Some(head.as_object()), [path])?;
    Ok(())
}

/// Discards unstaged workdir changes to `path`, restoring it to match the
/// index (the same thing `git checkout -- <path>` does). A path with no
/// index entry at all is untracked, so there's nothing to restore it to —
/// it's simply deleted instead.
pub fn discard_path(repo: &git2::Repository, path: &str) -> Result<(), GitCommandError> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| GitCommandError::Internal("bare repository does not support discard".into()))?;
    let mut index = repo.index()?;

    if index.get_path(std::path::Path::new(path), 0).is_none() {
        let full_path = workdir.join(path);
        if full_path.exists() {
            std::fs::remove_file(&full_path)
                .map_err(|e| GitCommandError::Internal(e.to_string()))?;
        }
        return Ok(());
    }

    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.path(path).force();
    repo.checkout_index(Some(&mut index), Some(&mut checkout))?;
    Ok(())
}

pub fn discard_all(repo: &git2::Repository) -> Result<(), GitCommandError> {
    for file in working_status(repo)?.unstaged {
        discard_path(repo, &file.path)?;
    }
    Ok(())
}

pub fn unstage_all(repo: &git2::Repository) -> Result<(), GitCommandError> {
    let head = repo.head()?.peel_to_commit()?;
    let status = working_status(repo)?;
    let paths: Vec<&str> = status.staged.iter().map(|f| f.path.as_str()).collect();
    if !paths.is_empty() {
        repo.reset_default(Some(head.as_object()), paths)?;
    }
    Ok(())
}

pub fn commit(
    repo: &git2::Repository,
    summary: &str,
    body: &str,
    author_name: Option<&str>,
    author_email: Option<&str>,
) -> Result<String, GitCommandError> {
    let sig = match (author_name, author_email) {
        (Some(name), Some(email)) => git2::Signature::now(name, email)?,
        _ => repo.signature()?,
    };
    let tree_id = repo.index()?.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let head = repo.head()?.peel_to_commit()?;
    let message = if body.trim().is_empty() {
        summary.to_string()
    } else {
        format!("{summary}\n\n{body}")
    };
    let oid = repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &[&head])?;
    Ok(oid.to_string())
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
    fn stages_unstages_and_commits() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = init_repo_with_commit(tmp.path());

        std::fs::write(tmp.path().join("a.txt"), "changed\n").unwrap();
        std::fs::write(tmp.path().join("b.txt"), "new\n").unwrap();

        let status = working_status(&repo).unwrap();
        assert_eq!(status.unstaged.len(), 2);
        assert_eq!(status.staged.len(), 0);

        stage_all(&repo).unwrap();
        let status = working_status(&repo).unwrap();
        assert_eq!(status.staged.len(), 2);
        assert_eq!(status.unstaged.len(), 0);

        unstage_path(&repo, "b.txt").unwrap();
        let status = working_status(&repo).unwrap();
        assert_eq!(status.staged.len(), 1);
        assert_eq!(status.unstaged.len(), 1);

        stage_path(&repo, "b.txt").unwrap();
        let sha = commit(&repo, "second commit", "", None, None).unwrap();
        assert!(!sha.is_empty());

        let status = working_status(&repo).unwrap();
        assert_eq!(status.staged.len(), 0);
        assert_eq!(status.unstaged.len(), 0);
    }

    #[test]
    fn commit_uses_the_given_author_override_instead_of_repo_signature() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = init_repo_with_commit(tmp.path());

        std::fs::write(tmp.path().join("a.txt"), "changed\n").unwrap();
        stage_all(&repo).unwrap();
        let sha = commit(&repo, "profile commit", "", Some("Profile Name"), Some("profile@example.com"))
            .unwrap();

        let oid = git2::Oid::from_str(&sha).unwrap();
        let found_commit = repo.find_commit(oid).unwrap();
        let author = found_commit.author();
        assert_eq!(author.name().unwrap(), "Profile Name");
        assert_eq!(author.email().unwrap(), "profile@example.com");
    }

    #[test]
    fn discards_a_modified_tracked_file_and_deletes_an_untracked_one() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = init_repo_with_commit(tmp.path());

        std::fs::write(tmp.path().join("a.txt"), "changed\n").unwrap();
        std::fs::write(tmp.path().join("b.txt"), "untracked\n").unwrap();

        discard_path(&repo, "a.txt").unwrap();
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("a.txt")).unwrap(),
            "hello\n"
        );

        discard_path(&repo, "b.txt").unwrap();
        assert!(!tmp.path().join("b.txt").exists());

        assert_eq!(working_status(&repo).unwrap().unstaged.len(), 0);
    }

    #[test]
    fn discard_all_clears_every_unstaged_change_but_leaves_staged_ones() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = init_repo_with_commit(tmp.path());

        std::fs::write(tmp.path().join("a.txt"), "changed\n").unwrap();
        std::fs::write(tmp.path().join("b.txt"), "untracked\n").unwrap();
        std::fs::write(tmp.path().join("c.txt"), "staged\n").unwrap();
        stage_path(&repo, "c.txt").unwrap();
        std::fs::write(tmp.path().join("c.txt"), "staged-then-changed\n").unwrap();

        discard_all(&repo).unwrap();

        assert_eq!(
            std::fs::read_to_string(tmp.path().join("a.txt")).unwrap(),
            "hello\n"
        );
        assert!(!tmp.path().join("b.txt").exists());
        // c.txt was staged separately — discard_all only touches unstaged changes
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("c.txt")).unwrap(),
            "staged\n"
        );
        let status = working_status(&repo).unwrap();
        assert_eq!(status.unstaged.len(), 0);
        assert_eq!(status.staged.len(), 1);
    }
}
