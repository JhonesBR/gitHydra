use tauri::State;
use uuid::Uuid;

use crate::error::GitCommandError;
use crate::git::repo::{RepoStatus, RepoSummary};
use crate::state::AppState;
use crate::terminal::{self, TerminalState};

#[tauri::command]
pub async fn open_repository(
    path: String,
    state: State<'_, AppState>,
) -> Result<RepoSummary, GitCommandError> {
    if let Some((distro, linux)) = crate::wslpath::parse_unc(&path) {
        return state.open_remote(&distro, linux).await;
    }
    state.open_local(Uuid::new_v4().to_string(), path)
}

#[tauri::command]
pub async fn get_repo_status(
    repo_id: String,
    state: State<'_, AppState>,
) -> Result<RepoStatus, GitCommandError> {
    state.actor(&repo_id)?.status().await
}

#[tauri::command]
pub async fn close_repository(
    repo_id: String,
    state: State<'_, AppState>,
    terminals: State<'_, TerminalState>,
) -> Result<(), GitCommandError> {
    terminal::kill(&terminals, &repo_id)?;
    let removed = state.repos.lock().unwrap().remove(&repo_id);
    if let Some(agent) = removed.and_then(|h| h.agent) {
        agent.call("close_repository", serde_json::json!({ "repoId": repo_id })).await?;
    }
    Ok(())
}
