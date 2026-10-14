use std::path::Path;
use std::process::{Command, Stdio};

use crate::activity;
use crate::error::GitCommandError;

/// Continues/aborts a rebase by shelling out to the system `git` binary.
/// Needed only for rebases libgit2 can't open itself — most notably
/// interactive rebases (`git rebase -i`), which `git2::Repository::open_rebase`
/// categorically refuses ("interactive rebase is not supported"). Everything
/// else in this app talks to git2/libgit2 directly; this is the one
/// deliberate exception, scoped to what libgit2 can't do (interactive
/// rebases, Git LFS).
fn run(repo_path: &Path, args: &[&str]) -> Result<(), GitCommandError> {
    run_with_env(repo_path, args, &[])
}

fn run_with_env(
    repo_path: &Path,
    args: &[&str],
    env: &[(&str, &str)],
) -> Result<(), GitCommandError> {
    activity::info(Some(repo_path), format!("$ git {}", args.join(" ")));
    let output = Command::new("git")
        .current_dir(repo_path)
        .args(args)
        // Continuing a plain `pick` step never needs an editor, but a
        // `reword`/`squash`/`edit` step further down the todo list might —
        // fail fast instead of hanging on a prompt we can't answer.
        .env("GIT_EDITOR", "true")
        .env("GIT_SEQUENCE_EDITOR", "true")
        .env("GIT_TERMINAL_PROMPT", "0")
        .envs(env.iter().copied())
        .stdin(Stdio::null())
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

/// `git rebase -i` with the todo list at `todo` (see `interactive_rebase`).
/// `upstream: None` rebases from the root commit. Git's own `--autostash`
/// takes care of uncommitted changes, restoring them when it finishes or aborts.
pub fn rebase_interactive(
    repo_path: &Path,
    upstream: Option<&str>,
    todo: &Path,
) -> Result<(), GitCommandError> {
    let editor = format!("cp {}", super::interactive_rebase::sh_quote(todo));
    // `--empty=drop`: a commit emptied by the reordering would otherwise
    // stop the rebase with nothing to resolve.
    let args = ["rebase", "-i", "--autostash", "--empty=drop", upstream.unwrap_or("--root")];
    run_with_env(repo_path, &args, &[("GIT_SEQUENCE_EDITOR", &editor)])
}

/// libgit2 doesn't run the LFS smudge filter, so checkouts it makes leave
/// pointer files; this fetches and checks out the real content.
pub fn lfs_pull(repo_path: &Path) -> Result<(), GitCommandError> {
    run(repo_path, &["lfs", "pull"])
}

/// Whether `git lfs` is available — asked once per app run.
pub fn lfs_installed() -> bool {
    static INSTALLED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *INSTALLED.get_or_init(|| {
        Command::new("git")
            .args(["lfs", "version"])
            .stdin(Stdio::null())
            .output()
            .is_ok_and(|o| o.status.success())
    })
}
