use serde::Serialize;

use crate::error::GitCommandError;
use crate::git::{remote, repo};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRepoEntry {
    pub name: String,
    pub path: String,
}

/// Lists git repositories in the immediate children of `path` — a plain
/// filesystem scan (no git2), since we're only listing candidates here;
/// opening still goes through the existing `open_repository` command.
#[tauri::command]
pub async fn scan_workspace(path: String) -> Result<Vec<WorkspaceRepoEntry>, GitCommandError> {
    let entries = std::fs::read_dir(&path).map_err(|e| GitCommandError::Internal(e.to_string()))?;

    let mut result = Vec::new();
    for entry in entries.flatten() {
        let entry_path = entry.path();
        if !entry_path.is_dir() || !entry_path.join(".git").exists() {
            continue;
        }
        let name = entry_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        result.push(WorkspaceRepoEntry {
            name,
            path: entry_path.to_string_lossy().into_owned(),
        });
    }
    result.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(result)
}

/// One-shot fetch of a single repo by path — not tied to any open repo's
/// `RepoActor`/repo_id, used for bulk "fetch all" over a workspace's repos
/// that aren't (and don't need to be) open in the app.
#[tauri::command]
pub async fn fetch_repo_at_path(path: String) -> Result<(), GitCommandError> {
    let repo = repo::open(&path)?;
    remote::fetch(&repo, "origin", |_, _, _| {})?;
    Ok(())
}
