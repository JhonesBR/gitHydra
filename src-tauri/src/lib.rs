pub mod activity;
pub mod agent;
pub mod identity;
pub mod workspace;
pub mod wsl;
pub mod wslpath;
#[cfg(feature = "gui")]
mod ai;
#[cfg(feature = "gui")]
mod cli;
#[cfg(feature = "gui")]
mod commands;
#[cfg(feature = "gui")]
mod editors;
pub mod error;
pub mod events;
pub mod git;
#[cfg(feature = "gui")]
mod github;
#[cfg(feature = "gui")]
mod gitlab;
#[cfg(feature = "gui")]
mod gui;
pub mod https_credentials;
pub mod passphrase;
pub mod proto;
pub mod remote_agent;
pub mod settings;
pub mod ssh_keys;
pub mod state;
pub mod terminal;

#[cfg(feature = "gui")]
pub use gui::run;

/// True when this process was started as ssh-keygen's askpass helper for
/// commit signing (it has then already printed its answer and must exit).
pub fn answer_askpass() -> bool {
    git::signing::answer_askpass()
}
