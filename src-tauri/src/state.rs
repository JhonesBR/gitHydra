use std::collections::HashMap;
use std::sync::Mutex;

use crate::error::GitCommandError;
use crate::git::actor::RepoActor;

pub struct RepoHandle {
    pub actor: RepoActor,
    pub path: String,
}

#[derive(Default)]
pub struct AppState {
    pub repos: Mutex<HashMap<String, RepoHandle>>,
}

impl AppState {
    /// Working directory the repo was opened at.
    pub fn repo_path(&self, repo_id: &str) -> Result<String, GitCommandError> {
        self.repos
            .lock()
            .unwrap()
            .get(repo_id)
            .map(|handle| handle.path.clone())
            .ok_or_else(|| GitCommandError::RepoNotFound { path: repo_id.to_string() })
    }

    pub fn actor(&self, repo_id: &str) -> Result<RepoActor, GitCommandError> {
        self.repos
            .lock()
            .unwrap()
            .get(repo_id)
            .map(|handle| handle.actor.clone())
            .ok_or_else(|| GitCommandError::RepoNotFound {
                path: repo_id.to_string(),
            })
    }
}
