use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error, Serialize, Deserialize)]
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

    /// A background operation found no stored HTTPS credentials for this
    /// remote; like `SshPassphraseRequired`, only a user-started one asks.
    #[error("{url} needs a username and password/token: run a fetch or push to enter them")]
    HttpsCredentialsRequired { url: String },

    /// Which remote to push to is ambiguous (no upstream, no `origin`, several
    /// remotes) or there's none; the UI lets the user pick one.
    #[error("choose a remote to push to")]
    RemoteRequired { remotes: Vec<String> },

    #[error("branch {branch} has no upstream: push it with tracking or set branch.{branch}.merge")]
    NoUpstream { branch: String },

    /// Pull in fast-forward-only mode (`pull.ff=only` or the user's choice)
    /// met a diverged upstream; the UI offers merge/rebase instead.
    #[error("cannot fast-forward to {upstream}: the branches have diverged")]
    PullNotFastForward { upstream: String },

    /// A git hook (pre-commit, commit-msg...) exited non-zero and aborted the
    /// commit; `output` is what it printed, for the UI to show.
    #[error("{hook} hook failed")]
    HookFailed { hook: String, output: String },

    /// Signing was required (commit.gpgsign or the app setting) but failed.
    #[error("could not sign the commit: {message}")]
    SigningFailed { message: String },
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
