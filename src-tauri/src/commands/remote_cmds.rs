use tauri::State;

use crate::error::GitCommandError;
use crate::git::actor::PushArgs;
use crate::git::remote::{AuthMode, FetchSummary, PushSummary};
use crate::state::AppState;

/// `background`: a fetch the user didn't ask for (on open), which must not
/// prompt for an SSH key passphrase.
#[tauri::command]
pub async fn fetch_remote(
    repo_id: String,
    remote_name: String,
    background: Option<bool>,
    state: State<'_, AppState>,
) -> Result<FetchSummary, GitCommandError> {
    state
        .actor(&repo_id)?
        .fetch(remote_name, auth_mode(background))
        .await
}

pub fn auth_mode(background: Option<bool>) -> AuthMode {
    if background.unwrap_or(false) {
        AuthMode::Background
    } else {
        AuthMode::Interactive
    }
}

#[tauri::command]
pub async fn get_remote_url(
    repo_id: String,
    remote_name: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, GitCommandError> {
    state.actor(&repo_id)?.get_remote_url(remote_name).await
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
