//! Backend-side filesystem scans that don't belong to an open repo.

use serde::{Deserialize, Serialize};

use crate::error::GitCommandError;
use crate::git::remote::AuthMode;
use crate::git::{remote, repo};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRepoEntry {
    pub name: String,
    pub path: String,
}

/// Lists git repositories in the immediate children of `path` — a plain
/// filesystem scan (no git2), since we're only listing candidates here;
/// opening still goes through the existing `open_repository` command.
pub fn scan(path: &str) -> Result<Vec<WorkspaceRepoEntry>, GitCommandError> {
    let entries = std::fs::read_dir(path).map_err(|e| GitCommandError::Internal(e.to_string()))?;

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

    // The workspace folder may itself be a repo (user picked the repo, not
    // its parent) — list it first so the workspace isn't silently empty.
    let root = std::path::Path::new(path);
    if root.join(".git").exists() {
        let name = root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        result.insert(
            0,
            WorkspaceRepoEntry {
                name,
                path: root.to_string_lossy().into_owned(),
            },
        );
    }
    Ok(result)
}

/// One-shot fetch of every remote of the repo at `path`. Blocking.
pub fn fetch_at_path(path: &str, mode: AuthMode) -> Result<(), GitCommandError> {
    let repo = repo::open(path)?;
    remote::fetch_remotes(&repo, None, mode, |_, _, _| {})?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_repo: bool,
}

/// Subfolders of `path` for the remote folder picker, dotfolders hidden.
pub fn list_dirs(path: &str) -> Result<Vec<DirEntry>, GitCommandError> {
    let mut dirs: Vec<DirEntry> = std::fs::read_dir(path)
        .map_err(|e| GitCommandError::Internal(e.to_string()))?
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            (!name.starts_with('.')).then(|| DirEntry {
                is_repo: e.path().join(".git").exists(),
                path: e.path().to_string_lossy().into_owned(),
                name,
            })
        })
        .collect();
    dirs.sort_by_key(|d| d.name.to_lowercase());
    Ok(dirs)
}
