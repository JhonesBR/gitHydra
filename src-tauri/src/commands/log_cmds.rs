use tauri::State;

use crate::error::GitCommandError;
use crate::git::log::{CommitLogPage, LogQuery};
use crate::state::AppState;

#[tauri::command]
pub async fn get_commit_log(
    repo_id: String,
    query: LogQuery,
    state: State<'_, AppState>,
) -> Result<CommitLogPage, GitCommandError> {
    state.actor(&repo_id)?.log(query).await
}
