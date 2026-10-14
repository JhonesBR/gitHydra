use std::path::Path;
use std::process::Command;

use crate::activity;
use crate::error::GitCommandError;

/// Continues/aborts a rebase by shelling out to the system `git` binary.
/// Needed only for rebases libgit2 can't open itself — most notably
/// interactive rebases (`git rebase -i`), which `git2::Repository::open_rebase`
/// categorically refuses ("interactive rebase is not supported"). Everything
/// else in this app talks to git2/libgit2 directly; this is the one
/// deliberate exception, scoped to exactly the two operations libgit2 can't do.
fn run(repo_path: &Path, args: &[&str]) -> Result<(), GitCommandError> {
    activity::info(Some(repo_path), format!("$ git {}", args.join(" ")));
    let output = Command::new("git")
        .current_dir(repo_path)
        .args(args)
        // Continuing a plain `pick` step never needs an editor, but a
        // `reword`/`squash`/`edit` step further down the todo list might —
        // fail fast instead of hanging on a prompt we can't answer.
        .env("GIT_EDITOR", "true")
        .env("GIT_SEQUENCE_EDITOR", "true")
        .output()
        .map_err(|e| GitCommandError::Internal(format!("failed to run git: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        activity::error(Some(repo_path), format!("git {} failed: {stderr}", args.join(" ")));
        return Err(GitCommandError::Internal(stderr));
    }
    Ok(())
}

pub fn rebase_continue(repo_path: &Path) -> Result<(), GitCommandError> {
    run(repo_path, &["rebase", "--continue"])
}

pub fn rebase_abort(repo_path: &Path) -> Result<(), GitCommandError> {
    run(repo_path, &["rebase", "--abort"])
}
