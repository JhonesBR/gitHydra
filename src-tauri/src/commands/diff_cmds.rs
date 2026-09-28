use tauri::State;

use crate::error::GitCommandError;
use crate::git::actor::{FileContentArgs, RangeDiffArgs};
use crate::git::diff::CommitDiff;
use crate::state::AppState;

#[tauri::command]
pub async fn get_commit_diff(
    repo_id: String,
    sha: String,
    state: State<'_, AppState>,
) -> Result<CommitDiff, GitCommandError> {
    state.actor(&repo_id)?.diff(sha).await
}

#[tauri::command]
pub async fn get_range_diff(
    repo_id: String,
    from_sha: String,
    to_sha: String,
    state: State<'_, AppState>,
) -> Result<CommitDiff, GitCommandError> {
    state
        .actor(&repo_id)?
        .range_diff(RangeDiffArgs { from_sha, to_sha })
        .await
}

#[tauri::command]
pub async fn get_file_content(
    repo_id: String,
    sha: Option<String>,
    path: String,
    state: State<'_, AppState>,
) -> Result<String, GitCommandError> {
    state.actor(&repo_id)?.file_content(FileContentArgs { sha, path }).await
}
