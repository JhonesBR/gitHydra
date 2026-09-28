use tauri::State;

use crate::error::GitCommandError;
use crate::git::actor::{CheckoutAtArgs, CherryPickArgs, CreateBranchArgs, ResetToCommitArgs};
use crate::git::branch::BranchInfo;
use crate::git::cherry_pick::CherryPickResult;
use crate::git::repo::RepoStatus;
use crate::state::AppState;

#[tauri::command]
pub async fn list_branches(
    repo_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<BranchInfo>, GitCommandError> {
    state.actor(&repo_id)?.list_branches().await
}

#[tauri::command]
pub async fn create_branch(
    repo_id: String,
    name: String,
    start_point: Option<String>,
    checkout: bool,
    state: State<'_, AppState>,
) -> Result<BranchInfo, GitCommandError> {
    state
        .actor(&repo_id)?
        .create_branch(CreateBranchArgs {
            name,
            start_point,
            checkout,
        })
        .await
}

#[tauri::command]
pub async fn checkout_branch(
    repo_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<RepoStatus, GitCommandError> {
    state.actor(&repo_id)?.checkout_branch(name).await
}

#[tauri::command]
pub async fn checkout_at(
    repo_id: String,
    name: String,
    target_sha: String,
    remote_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<RepoStatus, GitCommandError> {
    state
        .actor(&repo_id)?
        .checkout_at(CheckoutAtArgs {
            name,
            target_sha,
            remote_name,
        })
        .await
}

#[tauri::command]
pub async fn checkout_commit_detached(
    repo_id: String,
    sha: String,
    state: State<'_, AppState>,
) -> Result<RepoStatus, GitCommandError> {
    state.actor(&repo_id)?.checkout_commit_detached(sha).await
}

#[tauri::command]
pub async fn cherry_pick(
    repo_id: String,
    sha: String,
    create_commit: bool,
    state: State<'_, AppState>,
) -> Result<CherryPickResult, GitCommandError> {
    state
        .actor(&repo_id)?
        .cherry_pick(CherryPickArgs { sha, create_commit })
        .await
}

#[tauri::command]
pub async fn reset_to_commit(
    repo_id: String,
    sha: String,
    hard: bool,
    state: State<'_, AppState>,
) -> Result<RepoStatus, GitCommandError> {
    state
        .actor(&repo_id)?
        .reset_to_commit(ResetToCommitArgs { sha, hard })
        .await
}
