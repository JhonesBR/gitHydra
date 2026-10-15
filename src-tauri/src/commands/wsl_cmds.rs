//! Commands whose answer depends on which machine (Windows or a WSL distro)
//! the question is about, plus the WSL-only ones.

use serde_json::json;
use tauri::State;

use crate::error::GitCommandError;
use crate::https_credentials::{self, CredentialsRequest};
use crate::identity::{self, GlobalGitIdentity};
use crate::passphrase;
use crate::ssh_keys::{self, SshKeyInfo};
use crate::state::AppState;
use crate::workspace::DirEntry;
use crate::wsl;
use crate::wslpath;

#[tauri::command]
pub async fn list_wsl_distros() -> Vec<String> {
    wsl::blocking(wsl::list_distros).await.unwrap_or_default()
}

/// WSL's own home folder, as a UNC path: where its folder picker starts.
#[tauri::command]
pub async fn wsl_home(distro: String, state: State<'_, AppState>) -> Result<String, GitCommandError> {
    let agent = state.agent(&distro).await?;
    Ok(wslpath::to_unc(&distro, &agent.home))
}

/// Subfolders of a WSL UNC path, for the in-app folder picker (the native
/// dialog crawls over 9P).
#[tauri::command]
pub async fn list_wsl_dirs(path: String, state: State<'_, AppState>) -> Result<Vec<DirEntry>, GitCommandError> {
    let (agent, linux) = state
        .route(&path)
        .await?
        .ok_or_else(|| GitCommandError::Internal(format!("not a WSL path: {path}")))?;
    let mut dirs: Vec<DirEntry> = agent.call_as("list_dirs", json!({ "path": linux })).await?;
    for d in &mut dirs {
        d.path = wslpath::to_unc(&agent.distro, &d.path);
    }
    Ok(dirs)
}

/// Keys in `~/.ssh` of this machine, or of `distro` when given.
#[tauri::command]
pub async fn list_ssh_keys(distro: Option<String>, state: State<'_, AppState>) -> Result<Vec<SshKeyInfo>, GitCommandError> {
    match distro {
        Some(d) => state.agent(&d).await?.call_as("list_ssh_keys", json!({})).await,
        None => Ok(ssh_keys::list_ssh_keys()),
    }
}

#[tauri::command]
pub async fn get_global_git_identity(
    distro: Option<String>,
    state: State<'_, AppState>,
) -> Result<GlobalGitIdentity, GitCommandError> {
    match distro {
        Some(d) => state.agent(&d).await?.call_as("global_identity", json!({})).await,
        None => identity::global(),
    }
}

#[tauri::command]
pub async fn submit_ssh_passphrase(passphrase: Option<String>, state: State<'_, AppState>) -> Result<(), ()> {
    passphrase::submit_ssh_passphrase(passphrase.clone());
    state.broadcast("submit_ssh_passphrase", json!({ "passphrase": passphrase })).await;
    Ok(())
}

#[tauri::command]
pub async fn pending_ssh_passphrase(state: State<'_, AppState>) -> Result<Option<String>, ()> {
    Ok(match passphrase::pending_ssh_passphrase() {
        Some(key) => Some(key),
        None => state.first_answer("pending_ssh_passphrase").await,
    })
}

#[tauri::command]
pub async fn submit_https_credentials(
    username: Option<String>,
    password: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), ()> {
    https_credentials::submit_https_credentials(username.clone(), password.clone());
    state
        .broadcast("submit_https_credentials", json!({ "username": username, "password": password }))
        .await;
    Ok(())
}

#[tauri::command]
pub async fn pending_https_credentials(state: State<'_, AppState>) -> Result<Option<CredentialsRequest>, ()> {
    Ok(match https_credentials::pending_https_credentials() {
        Some(request) => Some(request),
        None => state.first_answer("pending_https_credentials").await,
    })
}
