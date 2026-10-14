use serde::Serialize;

use crate::editors::{self, EditorInfo};
use crate::error::GitCommandError;
use crate::state::AppState;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalGitIdentity {
    pub name: Option<String>,
    pub email: Option<String>,
}

/// Reads the machine's global git identity (`user.name`/`user.email`) — used
/// to seed the "Default" commit profile the first time the app runs.
#[tauri::command]
pub async fn get_global_git_identity() -> Result<GlobalGitIdentity, GitCommandError> {
    let cfg = git2::Config::open_default()?;
    Ok(GlobalGitIdentity {
        name: cfg.get_string("user.name").ok(),
        email: cfg.get_string("user.email").ok(),
    })
}

/// Editors found on this machine, for the default-editor setting.
#[tauri::command]
pub async fn list_installed_editors() -> Vec<EditorInfo> {
    editors::detect_editors(&editors::search_dirs())
}

/// Absolute path of `rel_path` inside the repo's working directory.
#[tauri::command]
pub async fn repo_file_path(
    repo_id: String,
    rel_path: String,
    state: State<'_, AppState>,
) -> Result<String, GitCommandError> {
    let root = state.repo_path(&repo_id)?;
    Ok(std::path::Path::new(&root).join(rel_path).to_string_lossy().into_owned())
}

/// Opens `path` with the editor launcher `command` (from `list_installed_editors`).
#[tauri::command]
pub async fn open_in_editor(command: String, path: String) -> Result<(), GitCommandError> {
    editors::open_with(&command, std::path::Path::new(&path))
        .map_err(|e| GitCommandError::Internal(format!("Could not launch {command}: {e}")))
}
