use serde::Serialize;

use crate::error::GitCommandError;

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
