use serde_json::json;
use tauri::State;

use crate::error::GitCommandError;
use crate::state::AppState;
use crate::workspace::{self, WorkspaceRepoEntry};
use crate::wslpath;

/// Lists git repositories in `path` and its immediate children. For a WSL
/// path the scan runs inside the distro and entries come back as UNC paths.
#[tauri::command]
pub async fn scan_workspace(
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceRepoEntry>, GitCommandError> {
    let Some((agent, linux)) = state.route(&path).await? else {
        return workspace::scan(&path);
    };
    let mut entries: Vec<WorkspaceRepoEntry> = agent.call_as("scan_workspace", json!({ "path": linux })).await?;
    for e in &mut entries {
        e.path = wslpath::to_unc(&agent.distro, &e.path);
    }
    Ok(entries)
}

/// One-shot fetch of a single repo by path — not tied to any open repo's
/// `RepoActor`/repo_id, used for bulk "fetch all" over a workspace's repos
/// that aren't (and don't need to be) open in the app. Fetches every remote;
/// `background` as in `fetch_remote` (the launch splash).
#[tauri::command]
pub async fn fetch_repo_at_path(
    path: String,
    background: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), GitCommandError> {
    if let Some((agent, linux)) = state.route(&path).await? {
        agent
            .call("fetch_repo_at_path", json!({ "path": linux, "background": background }))
            .await?;
        return Ok(());
    }
    let mode = super::remote_cmds::auth_mode(background);
    // Network + possibly a blocking credentials prompt: keep it off the async
    // workers, which the splash / "Fetch all" would otherwise all tie up at once.
    tauri::async_runtime::spawn_blocking(move || workspace::fetch_at_path(&path, mode))
        .await
        .map_err(|e| GitCommandError::Internal(e.to_string()))?
}
