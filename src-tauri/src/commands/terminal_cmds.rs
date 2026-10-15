use tauri::State;

use crate::error::GitCommandError;
use crate::terminal::{self, TerminalState};

#[tauri::command]
pub async fn terminal_spawn(
    repo_id: String,
    cwd: String,
    state: State<'_, TerminalState>,
) -> Result<(), GitCommandError> {
    terminal::spawn(&state, repo_id, cwd)
}

#[tauri::command]
pub async fn terminal_write(
    repo_id: String,
    data: String,
    state: State<'_, TerminalState>,
) -> Result<(), GitCommandError> {
    terminal::write(&state, &repo_id, &data)
}

#[tauri::command]
pub async fn terminal_resize(
    repo_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, TerminalState>,
) -> Result<(), GitCommandError> {
    terminal::resize(&state, &repo_id, cols, rows)
}

#[tauri::command]
pub async fn terminal_kill(
    repo_id: String,
    state: State<'_, TerminalState>,
) -> Result<(), GitCommandError> {
    terminal::kill(&state, &repo_id)
}
