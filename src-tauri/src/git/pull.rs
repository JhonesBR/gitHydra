//! `git pull` for the checked-out branch: fetch its upstream, then
//! fast-forward, merge or rebase onto it. Conflicts are left exactly the way
//! "Merge into current branch" and "Rebase onto" leave theirs, so the existing
//! conflict panel (continue/abort) finishes the job — including restoring the
//! autostash, which shares rebase's marker file.

use serde::{Deserialize, Serialize};

use crate::activity;
use crate::error::GitCommandError;

use super::merge;
use super::rebase::{self, ConflictedFile, RebaseState};
use super::remote::{self, AuthMode};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PullStrategy {
    FfOnly,
    Merge,
    Rebase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum PullOutcome {
    UpToDate,
    FastForwarded,
    Merged,
    Rebased,
    /// Stopped on conflicts: the repo is mid-merge or mid-rebase.
    Conflicts,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullResult {
    /// Short name of what was pulled, e.g. `origin/main`.
    pub upstream: String,
    pub strategy: PullStrategy,
    pub outcome: PullOutcome,
    /// Upstream commits that weren't on the branch yet.
    pub commits: usize,
    pub conflicts: Vec<ConflictedFile>,
    /// Re-applying the autostash conflicted (the pull itself went fine);
    /// reported through the same event a rebase's autostash uses.
    #[serde(skip)]
    pub autostash_conflicts: Vec<ConflictedFile>,
}

/// Where the checked-out branch stands against its upstream, for the Pull
/// button. Counts come from the last fetch; nothing here touches the network.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamStatus {
    pub upstream: String,
    pub ahead: usize,
    pub behind: usize,
    /// What a plain Pull does, per `pull.rebase` / `branch.<name>.rebase` / `pull.ff`.
    pub strategy: PullStrategy,
}

/// The checked-out branch's `branch.<name>.remote` / `.merge`.
struct Upstream {
    branch: String,
    head_ref: String,
    remote: String,
    /// Local ref holding the upstream's tip: `refs/remotes/<remote>/<b>`, or
    /// `refs/heads/<b>` when the remote is `.` (a local branch).
    tracking_ref: String,
    /// The branch's name on the remote (`branch.<name>.merge` without `refs/heads/`).
    merge_branch: String,
}

impl Upstream {
    fn display(&self) -> &str {
        self.tracking_ref
            .strip_prefix("refs/remotes/")
            .or_else(|| self.tracking_ref.strip_prefix("refs/heads/"))
            .unwrap_or(&self.tracking_ref)
    }
}

fn upstream_of_head(repo: &git2::Repository) -> Result<Upstream, GitCommandError> {
    let head = repo.head()?;
    if !head.is_branch() {
        return Err(GitCommandError::Internal(
            "HEAD is detached: check out a branch to pull".into(),
        ));
    }
    let head_ref = head.name().unwrap_or_default().to_string();
    let branch = head.shorthand().unwrap_or_default().to_string();
    let no_upstream = || GitCommandError::NoUpstream { branch: branch.clone() };

    let remote = repo
        .branch_upstream_remote(&head_ref)
        .ok()
        .and_then(|b| b.as_str().ok().map(String::from))
        .ok_or_else(no_upstream)?;
    let tracking_ref = repo
        .branch_upstream_name(&head_ref)
        .ok()
        .and_then(|b| b.as_str().ok().map(String::from))
        .ok_or_else(no_upstream)?;
    let merge_branch = repo
        .config()?
        .get_string(&format!("branch.{branch}.merge"))
        .map(|m| m.trim_start_matches("refs/heads/").to_string())
        .map_err(|_| no_upstream())?;

    Ok(Upstream { branch, head_ref, remote, tracking_ref, merge_branch })
}

/// What a plain `git pull` would do on `branch`, plus whether `pull.ff=false`
/// asks for a merge commit even when a fast-forward is possible.
/// `branch.<name>.rebase` wins over `pull.rebase`, and rebasing over `pull.ff`.
pub fn configured_strategy(config: &git2::Config, branch: &str) -> (PullStrategy, bool) {
    let get = |key: &str| config.get_string(key).ok().map(|v| v.trim().to_ascii_lowercase());
    let rebase = get(&format!("branch.{branch}.rebase")).or_else(|| get("pull.rebase"));
    if rebase.as_deref().is_some_and(rebase_enabled) {
        return (PullStrategy::Rebase, false);
    }
    match get("pull.ff").as_deref() {
        Some("only") => (PullStrategy::FfOnly, false),
        Some("false" | "no" | "off" | "0") => (PullStrategy::Merge, true),
        _ => (PullStrategy::Merge, false),
    }
}

/// `pull.rebase` takes a bool or a rebase flavour (`merges`, `interactive`);
/// any flavour still means "rebase", which is all we do.
fn rebase_enabled(value: &str) -> bool {
    matches!(value, "true" | "yes" | "on" | "1" | "merges" | "m" | "interactive" | "i")
}

/// Ahead/behind of the checked-out branch vs. its upstream as last fetched.
/// `None` when there's nothing to pull from (detached HEAD, no upstream).
pub fn upstream_status(repo: &git2::Repository) -> Result<Option<UpstreamStatus>, GitCommandError> {
    let Ok(up) = upstream_of_head(repo) else {
        return Ok(None);
    };
    let (strategy, _) = configured_strategy(&repo.config()?, &up.branch);
    let (ahead, behind) = match (repo.refname_to_id(&up.head_ref), repo.refname_to_id(&up.tracking_ref)) {
        (Ok(ours), Ok(theirs)) => repo.graph_ahead_behind(ours, theirs)?,
        // Upstream not fetched yet.
        _ => (0, 0),
    };
    Ok(Some(UpstreamStatus {
        upstream: up.display().to_string(),
        ahead,
        behind,
        strategy,
    }))
}

/// Pulls the checked-out branch. `choice` overrides the configured strategy
/// for this one pull. Uncommitted changes are stashed first and restored once
/// the pull is through — after continue/abort when it stops on conflicts.
pub fn pull(
    repo: &mut git2::Repository,
    choice: Option<PullStrategy>,
    on_progress: impl FnMut(usize, usize, usize) + 'static,
) -> Result<PullResult, GitCommandError> {
    if repo.state() != git2::RepositoryState::Clean || rebase::is_rebase_in_progress(repo) {
        return Err(GitCommandError::Internal(
            "finish or abort the merge/rebase in progress before pulling".into(),
        ));
    }
    let up = upstream_of_head(repo)?;
    let (configured, config_no_ff) = configured_strategy(&repo.config()?, &up.branch);
    let strategy = choice.unwrap_or(configured);
    let no_ff = strategy == PullStrategy::Merge && config_no_ff;

    let flag = match strategy {
        PullStrategy::FfOnly => "--ff-only",
        PullStrategy::Merge if no_ff => "--no-rebase --no-ff",
        PullStrategy::Merge => "--no-rebase",
        PullStrategy::Rebase => "--rebase",
    };
    let dir = repo.workdir().unwrap_or(repo.path()).to_path_buf();
    activity::info(Some(&dir), format!("$ git pull {flag} {} {}", up.remote, up.merge_branch));

    if up.remote != "." {
        remote::fetch(repo, &up.remote, AuthMode::Interactive, on_progress)?;
    }

    let their_oid = repo.refname_to_id(&up.tracking_ref).map_err(|_| {
        GitCommandError::Internal(format!("{} does not exist: nothing to pull", up.display()))
    })?;
    let head_oid = repo.refname_to_id(&up.head_ref)?;
    let (_, commits) = repo.graph_ahead_behind(head_oid, their_oid)?;
    let analysis = {
        let theirs = repo.find_annotated_commit(their_oid)?;
        repo.merge_analysis(&[&theirs])?.0
    };

    let result = |outcome, conflicts| PullResult {
        upstream: up.display().to_string(),
        strategy,
        outcome,
        commits,
        conflicts,
        autostash_conflicts: Vec::new(),
    };
    if analysis.is_up_to_date() {
        return Ok(result(PullOutcome::UpToDate, Vec::new()));
    }
    let fast_forward = analysis.is_fast_forward() && !no_ff;
    if strategy == PullStrategy::FfOnly && !fast_forward {
        return Err(GitCommandError::PullNotFastForward {
            upstream: up.display().to_string(),
        });
    }

    let stashed = rebase::has_uncommitted_changes(repo)?;
    if stashed {
        rebase::autostash(repo)?;
    }
    let integrated = if fast_forward {
        fast_forward_to(repo, &up.head_ref, their_oid).map(|_| (PullOutcome::FastForwarded, Vec::new()))
    } else if strategy == PullStrategy::Rebase {
        rebase::start(repo, &up.tracking_ref).map(|(_session, status)| match status.state {
            RebaseState::Complete => (PullOutcome::Rebased, Vec::new()),
            RebaseState::Conflicts => (PullOutcome::Conflicts, status.conflicts),
        })
    } else {
        merge_upstream(repo, &up)
    };

    match integrated {
        Ok((outcome, conflicts)) => {
            let mut out = result(outcome, conflicts);
            // On conflicts the stash waits for continue/abort, like rebase's.
            if outcome != PullOutcome::Conflicts {
                out.autostash_conflicts = rebase::pop_autostash_if_any(repo)?;
            }
            Ok(out)
        }
        Err(e) => {
            // Nothing was changed (e.g. an untracked file in the way): put the
            // changes back. If a rebase did start, its abort restores them.
            if stashed
                && repo.state() == git2::RepositoryState::Clean
                && !rebase::is_rebase_in_progress(repo)
            {
                let _ = rebase::pop_autostash_if_any(repo);
            }
            Err(e)
        }
    }
}

/// Moves the branch to `target` after checking its tree out; a safe checkout
/// refuses (changing nothing) if that would clobber a file.
fn fast_forward_to(
    repo: &git2::Repository,
    head_ref: &str,
    target: git2::Oid,
) -> Result<(), GitCommandError> {
    let commit = repo.find_commit(target)?;
    repo.checkout_tree(commit.as_object(), Some(git2::build::CheckoutBuilder::new().safe()))?;
    repo.find_reference(head_ref)?
        .set_target(target, &format!("pull: Fast-forward to {target}"))?;
    Ok(())
}

/// Merge commit named the way `git pull` names it.
fn merge_upstream(
    repo: &git2::Repository,
    up: &Upstream,
) -> Result<(PullOutcome, Vec<ConflictedFile>), GitCommandError> {
    let message = if up.remote == "." {
        format!("Merge branch '{}'", up.merge_branch)
    } else {
        let url = repo
            .find_remote(&up.remote)?
            .url()
            .unwrap_or(&up.remote)
            .to_string();
        format!("Merge branch '{}' of {url}", up.merge_branch)
    };
    let their_ref = repo.find_reference(&up.tracking_ref)?;
    let merged = merge::merge_reference(repo, &their_ref, &message)?;
    Ok(if merged.conflicts.is_empty() {
        (PullOutcome::Merged, Vec::new())
    } else {
        (PullOutcome::Conflicts, merged.conflicts)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn configure(repo: &git2::Repository) {
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test").unwrap();
        config.set_str("user.email", "test@example.com").unwrap();
        // Pin what a machine's global config could change under the tests.
        config.set_bool("core.autocrlf", false).unwrap();
        config.set_bool("pull.rebase", false).unwrap();
        config.set_str("pull.ff", "true").unwrap();
    }

    fn commit_file(repo: &git2::Repository, file: &str, content: &str, msg: &str) -> git2::Oid {
        std::fs::write(repo.workdir().unwrap().join(file), content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(file)).unwrap();
        let tree_id = index.write_tree().unwrap();
        index.write().unwrap();
        let sig = git2::Signature::now("Test", "test@example.com").unwrap();
        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.iter().collect();
        let tree = repo.find_tree(tree_id).unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &parents).unwrap()
    }

    fn head_oid(repo: &git2::Repository) -> git2::Oid {
        repo.head().unwrap().target().unwrap()
    }

    fn read(repo: &git2::Repository, file: &str) -> String {
        std::fs::read_to_string(repo.workdir().unwrap().join(file)).unwrap()
    }

    /// A bare "server" plus two clones of it: `local` (the one pulling, its
    /// branch tracking origin) and `other` (pushing commits to pull).
    struct Setup {
        _dirs: Vec<tempfile::TempDir>,
        local: git2::Repository,
        other: git2::Repository,
        branch: String,
    }

    fn setup() -> Setup {
        let bare = tempfile::tempdir().unwrap();
        git2::Repository::init_bare(bare.path()).unwrap();
        let bare_url = bare.path().to_str().unwrap().to_string();

        let seed_dir = tempfile::tempdir().unwrap();
        let seed = git2::Repository::init(seed_dir.path()).unwrap();
        configure(&seed);
        commit_file(&seed, "a.txt", "base", "initial");
        let branch = seed.head().unwrap().shorthand().unwrap().to_string();
        seed.remote("origin", &bare_url).unwrap();
        remote::push(&seed, "origin", &branch, false, |_, _, _| {}).unwrap();
        // The bare repo's HEAD may name another default branch; point it at ours.
        git2::Repository::open_bare(bare.path())
            .unwrap()
            .set_head(&format!("refs/heads/{branch}"))
            .unwrap();

        let clone = |dir: &tempfile::TempDir| {
            let repo = git2::Repository::clone(&bare_url, dir.path()).unwrap();
            configure(&repo);
            repo
        };
        let local_dir = tempfile::tempdir().unwrap();
        let other_dir = tempfile::tempdir().unwrap();
        let local = clone(&local_dir);
        let other = clone(&other_dir);
        Setup { _dirs: vec![bare, seed_dir, local_dir, other_dir], local, other, branch }
    }

    impl Setup {
        /// Commits on `other` and pushes it, returning the new remote tip.
        fn upstream_commit(&self, file: &str, content: &str) -> git2::Oid {
            let oid = commit_file(&self.other, file, content, &format!("remote {file}"));
            remote::push(&self.other, "origin", &self.branch, false, |_, _, _| {}).unwrap();
            oid
        }
    }

    fn pull_with(repo: &mut git2::Repository, choice: Option<PullStrategy>) -> Result<PullResult, GitCommandError> {
        pull(repo, choice, |_, _, _| {})
    }

    #[test]
    fn fast_forwards_when_behind() {
        let mut s = setup();
        let remote_tip = s.upstream_commit("b.txt", "remote");

        let result = pull_with(&mut s.local, None).unwrap();
        assert_eq!(result.outcome, PullOutcome::FastForwarded);
        assert_eq!(result.commits, 1);
        assert_eq!(result.upstream, format!("origin/{}", s.branch));
        assert_eq!(head_oid(&s.local), remote_tip);
        assert_eq!(read(&s.local, "b.txt"), "remote");
        assert!(!rebase::has_uncommitted_changes(&s.local).unwrap());

        let again = pull_with(&mut s.local, None).unwrap();
        assert_eq!(again.outcome, PullOutcome::UpToDate);
    }

    #[test]
    fn rebase_choice_still_fast_forwards_without_local_commits() {
        let mut s = setup();
        let remote_tip = s.upstream_commit("b.txt", "remote");
        let result = pull_with(&mut s.local, Some(PullStrategy::Rebase)).unwrap();
        assert_eq!(result.outcome, PullOutcome::FastForwarded);
        assert_eq!(head_oid(&s.local), remote_tip);
    }

    #[test]
    fn merges_a_diverged_upstream() {
        let mut s = setup();
        let remote_tip = s.upstream_commit("b.txt", "remote");
        let local_tip = commit_file(&s.local, "c.txt", "local", "local change");

        let result = pull_with(&mut s.local, Some(PullStrategy::Merge)).unwrap();
        assert_eq!(result.outcome, PullOutcome::Merged);
        let head = s.local.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.parent_ids().collect::<Vec<_>>(), [local_tip, remote_tip]);
        assert!(head
            .message()
            .unwrap()
            .starts_with(&format!("Merge branch '{}' of ", s.branch)));
        assert_eq!(s.local.state(), git2::RepositoryState::Clean);
        assert_eq!(read(&s.local, "b.txt"), "remote");
    }

    #[test]
    fn pull_ff_false_makes_a_merge_commit_even_when_fast_forwardable() {
        let mut s = setup();
        s.local.config().unwrap().set_str("pull.ff", "false").unwrap();
        let remote_tip = s.upstream_commit("b.txt", "remote");
        let result = pull_with(&mut s.local, None).unwrap();
        assert_eq!(result.outcome, PullOutcome::Merged);
        let head = s.local.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.parent_count(), 2);
        assert_eq!(head.parent_id(1).unwrap(), remote_tip);
    }

    #[test]
    fn rebases_local_commits_onto_the_upstream() {
        let mut s = setup();
        let remote_tip = s.upstream_commit("b.txt", "remote");
        commit_file(&s.local, "c.txt", "local", "local change");

        let result = pull_with(&mut s.local, Some(PullStrategy::Rebase)).unwrap();
        assert_eq!(result.outcome, PullOutcome::Rebased);
        let head = s.local.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.parent_ids().collect::<Vec<_>>(), [remote_tip]);
        assert_eq!(head.summary().unwrap(), Some("local change"));
        assert!(s.local.head().unwrap().is_branch());
        assert!(!rebase::is_rebase_in_progress(&s.local));
    }

    #[test]
    fn config_pull_rebase_picks_rebase() {
        let mut s = setup();
        s.local.config().unwrap().set_bool("pull.rebase", true).unwrap();
        s.upstream_commit("b.txt", "remote");
        commit_file(&s.local, "c.txt", "local", "local change");
        let result = pull_with(&mut s.local, None).unwrap();
        assert_eq!(result.strategy, PullStrategy::Rebase);
        assert_eq!(result.outcome, PullOutcome::Rebased);
    }

    #[test]
    fn ff_only_refuses_a_diverged_upstream_and_changes_nothing() {
        let mut s = setup();
        s.local.config().unwrap().set_str("pull.ff", "only").unwrap();
        s.upstream_commit("b.txt", "remote");
        let local_tip = commit_file(&s.local, "c.txt", "local", "local change");
        std::fs::write(s.local.workdir().unwrap().join("a.txt"), "dirty").unwrap();

        let err = pull_with(&mut s.local, None).unwrap_err();
        assert!(matches!(err, GitCommandError::PullNotFastForward { .. }), "{err:?}");
        assert_eq!(head_oid(&s.local), local_tip);
        assert_eq!(read(&s.local, "a.txt"), "dirty");

        // The one-off override still works.
        let result = pull_with(&mut s.local, Some(PullStrategy::Merge)).unwrap();
        assert_eq!(result.outcome, PullOutcome::Merged);
        assert_eq!(read(&s.local, "a.txt"), "dirty");
    }

    #[test]
    fn merge_conflict_leaves_merge_state_for_the_conflict_panel() {
        let mut s = setup();
        let remote_tip = s.upstream_commit("a.txt", "remote");
        commit_file(&s.local, "a.txt", "local", "local change");

        let result = pull_with(&mut s.local, Some(PullStrategy::Merge)).unwrap();
        assert_eq!(result.outcome, PullOutcome::Conflicts);
        assert_eq!(result.conflicts.len(), 1);
        assert_eq!(result.conflicts[0].path, "a.txt");
        assert_eq!(s.local.state(), git2::RepositoryState::Merge);
        // Same status the conflict panel reads.
        assert_eq!(rebase::read_status(&s.local).unwrap().unwrap().conflicts.len(), 1);

        rebase::resolve_conflict(&s.local, "a.txt", rebase::ConflictResolution::UseTheirs).unwrap();
        merge::continue_merge(&mut s.local).unwrap();
        let head = s.local.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.parent_id(1).unwrap(), remote_tip);
        assert_eq!(read(&s.local, "a.txt"), "remote");
    }

    #[test]
    fn rebase_conflict_leaves_a_rebase_in_progress() {
        let mut s = setup();
        s.upstream_commit("a.txt", "remote");
        commit_file(&s.local, "a.txt", "local", "local change");

        let result = pull_with(&mut s.local, Some(PullStrategy::Rebase)).unwrap();
        assert_eq!(result.outcome, PullOutcome::Conflicts);
        assert_eq!(result.conflicts[0].path, "a.txt");
        assert!(rebase::is_rebase_in_progress(&s.local));

        let err = pull_with(&mut s.local, None).unwrap_err();
        assert!(matches!(err, GitCommandError::Internal(_)));

        rebase::resolve_conflict(&s.local, "a.txt", rebase::ConflictResolution::UseOurs).unwrap();
        let mut session = s.local.open_rebase(None).unwrap();
        let status = rebase::advance(&s.local, &mut session, true).unwrap();
        assert!(matches!(status.state, RebaseState::Complete));
    }

    #[test]
    fn errors_clearly_without_an_upstream() {
        let dir = tempfile::tempdir().unwrap();
        let mut repo = git2::Repository::init(dir.path()).unwrap();
        configure(&repo);
        commit_file(&repo, "a.txt", "base", "initial");
        let branch = repo.head().unwrap().shorthand().unwrap().to_string();

        let err = pull_with(&mut repo, None).unwrap_err();
        assert!(matches!(&err, GitCommandError::NoUpstream { branch: b } if *b == branch), "{err:?}");
        assert!(upstream_status(&repo).unwrap().is_none());
    }

    #[test]
    fn autostashes_dirty_changes_around_the_pull() {
        let mut s = setup();
        s.upstream_commit("b.txt", "remote");
        commit_file(&s.local, "c.txt", "local", "local change");
        std::fs::write(s.local.workdir().unwrap().join("a.txt"), "dirty").unwrap();

        let result = pull_with(&mut s.local, Some(PullStrategy::Rebase)).unwrap();
        assert_eq!(result.outcome, PullOutcome::Rebased);
        assert!(result.autostash_conflicts.is_empty());
        assert_eq!(read(&s.local, "a.txt"), "dirty");
        assert_eq!(read(&s.local, "b.txt"), "remote");
        assert!(crate::git::stash::list(&mut s.local).unwrap().is_empty());
    }

    #[test]
    fn failed_fast_forward_puts_the_autostash_back() {
        let mut s = setup();
        let before = head_oid(&s.local);
        s.upstream_commit("b.txt", "remote");
        // Untracked (so not stashed) and in the way of the incoming file.
        std::fs::write(s.local.workdir().unwrap().join("b.txt"), "mine").unwrap();
        std::fs::write(s.local.workdir().unwrap().join("a.txt"), "dirty").unwrap();

        assert!(pull_with(&mut s.local, None).is_err());
        assert_eq!(head_oid(&s.local), before);
        assert_eq!(read(&s.local, "a.txt"), "dirty");
        assert_eq!(read(&s.local, "b.txt"), "mine");
        assert!(crate::git::stash::list(&mut s.local).unwrap().is_empty());
    }

    #[test]
    fn autostash_waits_for_the_conflicted_merge_to_finish() {
        let mut s = setup();
        s.upstream_commit("a.txt", "remote");
        commit_file(&s.local, "a.txt", "local", "local change");
        std::fs::write(s.local.workdir().unwrap().join("c.txt"), "dirty").unwrap();
        let mut index = s.local.index().unwrap();
        index.add_path(Path::new("c.txt")).unwrap();
        index.write().unwrap();

        let result = pull_with(&mut s.local, Some(PullStrategy::Merge)).unwrap();
        assert_eq!(result.outcome, PullOutcome::Conflicts);
        assert!(!s.local.workdir().unwrap().join("c.txt").exists());

        rebase::resolve_conflict(&s.local, "a.txt", rebase::ConflictResolution::UseOurs).unwrap();
        merge::continue_merge(&mut s.local).unwrap();
        rebase::pop_autostash_if_any(&mut s.local).unwrap();
        assert_eq!(read(&s.local, "c.txt"), "dirty");
    }

    #[test]
    fn reports_ahead_and_behind_from_the_last_fetch() {
        let mut s = setup();
        s.upstream_commit("b.txt", "remote");
        commit_file(&s.local, "c.txt", "local", "local change");

        let before = upstream_status(&s.local).unwrap().unwrap();
        assert_eq!((before.ahead, before.behind), (1, 0));
        remote::fetch(&s.local, "origin", AuthMode::Interactive, |_, _, _| {}).unwrap();
        let after = upstream_status(&s.local).unwrap().unwrap();
        assert_eq!((after.ahead, after.behind), (1, 1));
        assert_eq!(after.strategy, PullStrategy::Merge);

        pull_with(&mut s.local, None).unwrap();
        let merged = upstream_status(&s.local).unwrap().unwrap();
        assert_eq!((merged.ahead, merged.behind), (2, 0));
    }

    fn config_with(entries: &[(&str, &str)]) -> (tempfile::TempDir, git2::Config) {
        let dir = tempfile::tempdir().unwrap();
        let mut config = git2::Config::open(&dir.path().join("config")).unwrap();
        for (k, v) in entries {
            config.set_str(k, v).unwrap();
        }
        (dir, config)
    }

    #[test]
    fn configured_strategy_follows_git_precedence() {
        let cases: &[(&[(&str, &str)], (PullStrategy, bool))] = &[
            (&[], (PullStrategy::Merge, false)),
            (&[("pull.ff", "only")], (PullStrategy::FfOnly, false)),
            (&[("pull.ff", "false")], (PullStrategy::Merge, true)),
            (&[("pull.rebase", "true")], (PullStrategy::Rebase, false)),
            (&[("pull.rebase", "merges")], (PullStrategy::Rebase, false)),
            (&[("pull.rebase", "true"), ("pull.ff", "only")], (PullStrategy::Rebase, false)),
            (&[("pull.rebase", "true"), ("branch.main.rebase", "false")], (PullStrategy::Merge, false)),
            (&[("pull.rebase", "false"), ("branch.main.rebase", "true")], (PullStrategy::Rebase, false)),
            (&[("branch.other.rebase", "true")], (PullStrategy::Merge, false)),
        ];
        for (entries, expected) in cases {
            let (_dir, config) = config_with(entries);
            assert_eq!(configured_strategy(&config, "main"), *expected, "{entries:?}");
        }
    }
}
