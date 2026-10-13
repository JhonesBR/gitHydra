use tauri::State;

use crate::error::GitCommandError;
use crate::git::actor::{AmendMessageArgs, CommitChangesArgs};
use crate::git::diff::CommitDiff;
use crate::git::log::CommitNode;
use crate::git::working::WorkingStatus;
use crate::state::AppState;

#[tauri::command]
pub async fn get_working_status(
    repo_id: String,
    state: State<'_, AppState>,
) -> Result<WorkingStatus, GitCommandError> {
    state.actor(&repo_id)?.working_status().await
}

#[tauri::command]
pub async fn stage_path(
    repo_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), GitCommandError> {
    state.actor(&repo_id)?.stage_path(path).await
}

#[tauri::command]
pub async fn stage_all(repo_id: String, state: State<'_, AppState>) -> Result<(), GitCommandError> {
    state.actor(&repo_id)?.stage_all().await
}

#[tauri::command]
pub async fn unstage_path(
    repo_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), GitCommandError> {
    state.actor(&repo_id)?.unstage_path(path).await
}

#[tauri::command]
pub async fn unstage_all(
    repo_id: String,
    state: State<'_, AppState>,
) -> Result<(), GitCommandError> {
    state.actor(&repo_id)?.unstage_all().await
}

#[tauri::command]
pub async fn discard_path(
    repo_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), GitCommandError> {
    state.actor(&repo_id)?.discard_path(path).await
}

#[tauri::command]
pub async fn discard_all(
    repo_id: String,
    state: State<'_, AppState>,
) -> Result<(), GitCommandError> {
    state.actor(&repo_id)?.discard_all().await
}

#[tauri::command]
pub async fn get_workdir_diff(
    repo_id: String,
    staged: bool,
    state: State<'_, AppState>,
) -> Result<CommitDiff, GitCommandError> {
    state.actor(&repo_id)?.workdir_diff(staged).await
}

#[tauri::command]
pub async fn commit_changes(
    repo_id: String,
    summary: String,
    body: String,
    author_name: Option<String>,
    author_email: Option<String>,
    amend: bool,
    state: State<'_, AppState>,
) -> Result<String, GitCommandError> {
    state
        .actor(&repo_id)?
        .commit_changes(CommitChangesArgs {
            summary,
            body,
            author_name,
            author_email,
            amend,
        })
        .await
}

#[tauri::command]
pub async fn amend_commit_message(
    repo_id: String,
    sha: String,
    summary: String,
    body: String,
    state: State<'_, AppState>,
) -> Result<CommitNode, GitCommandError> {
    state
        .actor(&repo_id)?
        .amend_message(AmendMessageArgs { sha, summary, body })
        .await
}
