use tauri::State;

use crate::error::GitCommandError;
use crate::git::undo::UndoStatus;
use crate::state::AppState;

/// Reverts the last local action; returns its label.
#[tauri::command]
pub async fn undo_last_action(
    repo_id: String,
    state: State<'_, AppState>,
) -> Result<String, GitCommandError> {
    state.actor(&repo_id)?.undo().await
}

/// Re-applies the last undone action; returns its label.
#[tauri::command]
pub async fn redo_last_action(
    repo_id: String,
    state: State<'_, AppState>,
) -> Result<String, GitCommandError> {
    state.actor(&repo_id)?.redo().await
}

#[tauri::command]
pub async fn get_undo_status(
    repo_id: String,
    state: State<'_, AppState>,
) -> Result<UndoStatus, GitCommandError> {
    state.actor(&repo_id)?.undo_status().await
}
