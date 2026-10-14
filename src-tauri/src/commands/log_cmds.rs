use tauri::State;

use crate::error::GitCommandError;
use crate::git::log::{CommitLogPage, CommitNode, LogQuery};
use crate::git::reflog::ReflogEntry;
use crate::git::stats::RepoStats;
use crate::state::AppState;

#[tauri::command]
pub async fn get_commit_log(
    repo_id: String,
    query: LogQuery,
    state: State<'_, AppState>,
) -> Result<CommitLogPage, GitCommandError> {
    state.actor(&repo_id)?.log(query).await
}

#[tauri::command]
pub async fn get_head_commit(
    repo_id: String,
    state: State<'_, AppState>,
) -> Result<Option<CommitNode>, GitCommandError> {
    state.actor(&repo_id)?.head_commit().await
}

#[tauri::command]
pub async fn get_repo_stats(
    repo_id: String,
    state: State<'_, AppState>,
) -> Result<RepoStats, GitCommandError> {
    state.actor(&repo_id)?.stats().await
}

#[tauri::command]
pub async fn get_reflog(
    repo_id: String,
    ref_name: String,
    state: State<'_, AppState>,
) -> Result<Vec<ReflogEntry>, GitCommandError> {
    state.actor(&repo_id)?.reflog(ref_name).await
}
