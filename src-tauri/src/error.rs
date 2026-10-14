use serde::Serialize;

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "details")]
pub enum GitCommandError {
    #[error("repository not found or invalid: {path}")]
    RepoNotFound { path: String },

    #[error("git error ({code}/{class}): {message}")]
    Libgit2 {
        code: String,
        class: String,
        message: String,
    },

    #[error("internal error: {0}")]
    Internal(String),

    #[error("push rejected: the remote has commits you don't have locally ({message})")]
    PushRejectedNonFastForward { message: String },

    /// A background operation needed this SSH key's passphrase, which it may
    /// not ask for; an operation the user starts will.
    #[error("SSH key {key} is locked: run a fetch or push to enter its passphrase")]
    SshPassphraseRequired { key: String },
}

impl From<git2::Error> for GitCommandError {
    fn from(e: git2::Error) -> Self {
        GitCommandError::Libgit2 {
            code: format!("{:?}", e.code()),
            class: format!("{:?}", e.class()),
            message: e.message().to_string(),
        }
    }
}
