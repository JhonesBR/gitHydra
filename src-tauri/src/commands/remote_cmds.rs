use tauri::State;

use crate::error::GitCommandError;
use crate::git::actor::PushArgs;
use crate::git::remote::{FetchSummary, PushSummary};
use crate::state::AppState;

#[tauri::command]
pub async fn fetch_remote(
    repo_id: String,
    remote_name: String,
    state: State<'_, AppState>,
) -> Result<FetchSummary, GitCommandError> {
    state.actor(&repo_id)?.fetch(remote_name).await
}

#[tauri::command]
pub async fn push_branch(
    repo_id: String,
    remote_name: String,
    branch: String,
    force: bool,
    state: State<'_, AppState>,
) -> Result<PushSummary, GitCommandError> {
    state
        .actor(&repo_id)?
        .push(PushArgs {
            remote_name,
            branch,
            force,
        })
        .await
}
