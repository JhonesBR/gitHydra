use std::collections::HashMap;
use std::sync::Mutex;

use crate::error::GitCommandError;
use crate::git::actor::RepoActor;

pub struct RepoHandle {
    pub actor: RepoActor,
}

#[derive(Default)]
pub struct AppState {
    pub repos: Mutex<HashMap<String, RepoHandle>>,
}

impl AppState {
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
