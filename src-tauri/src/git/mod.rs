pub mod actor;
pub mod branch;
pub mod cherry_pick;
pub mod compose;
pub mod diff;
pub mod external_git;
pub mod fingerprint;
pub mod history;
pub mod hooks;
pub mod ignore;
pub mod interactive_rebase;
pub mod lfs;
pub mod log;
pub mod merge;
pub mod partial;
pub mod pull;
pub mod rebase;
pub mod reflog;
pub mod remote;
pub mod repo;
pub mod revert;
pub mod search;
pub mod signing;
pub mod stash;
pub mod stats;
pub mod submodule;
pub mod undo;
pub mod working;
pub mod worktree;
#[cfg(test)]
mod perf_tests;

/// Give every libgit2 network operation (fetch, push, pull, clone) 30s to
/// connect and 30s of silence before failing, so an unreachable remote (VPN
/// down) errors out instead of hanging. Call once at startup, before any
/// thread exists (libgit2 keeps these as unsynchronized globals).
pub fn init_network_timeouts() {
    const MS: i32 = 30_000;
    // SAFETY: called first thing in `main`, single-threaded.
    unsafe {
        let _ = git2::opts::set_server_connect_timeout_in_milliseconds(MS);
        let _ = git2::opts::set_server_timeout_in_milliseconds(MS);
    }
}
