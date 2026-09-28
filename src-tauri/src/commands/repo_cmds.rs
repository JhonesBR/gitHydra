use tauri::State;
use uuid::Uuid;

use crate::error::GitCommandError;
use crate::git::actor::RepoActor;
use crate::git::repo::{self, RepoStatus, RepoSummary};
use crate::state::{AppState, RepoHandle};

#[tauri::command]
pub async fn open_repository(
    path: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<RepoSummary, GitCommandError> {
    let repository = repo::open(&path)?;
    let repo_id = Uuid::new_v4().to_string();
    let summary = repo::summary(repo_id.clone(), path, &repository);

    let actor = RepoActor::spawn(repository, app, repo_id.clone());
    state
        .repos
        .lock()
        .unwrap()
        .insert(repo_id, RepoHandle { actor });

    Ok(summary)
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
) -> Result<(), GitCommandError> {
    state.repos.lock().unwrap().remove(&repo_id);
    Ok(())
}
