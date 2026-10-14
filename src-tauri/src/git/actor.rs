use std::sync::mpsc;
use std::time::Instant;

use serde::Serialize;
use tauri::Emitter;
use tokio::sync::oneshot;

use crate::error::GitCommandError;

use super::branch::{self, BranchInfo, TagInfo};
use super::cherry_pick::{self, CherryPickResult};
use super::diff::{self, CommitDiff};
use super::external_git;
use super::log::{self, CommitLogPage, CommitNode, LogQuery};
use super::merge::{self, MergeResult};
use super::pull::{self, PullResult, PullStrategy, UpstreamStatus};
use super::rebase::{self, ConflictResolution, RebaseStatus};
use super::remote::{self, AuthMode, FetchSummary, PushSummary, RemoteInfo};
use super::repo::{self, RepoStatus};
use super::signing;
use super::stash::{self, StashInfo, StashPopResult};
use super::reflog::{self, ReflogEntry};
use super::stats::{self, RepoStats};
use super::undo::{self, UndoHistory, UndoStatus};
use super::working::{self, WorkingStatus};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FetchProgressEvent {
    repo_id: String,
    received_objects: usize,
    total_objects: usize,
    received_bytes: usize,
    /// Periodic / on-open fetches: the UI shows no progress toast for these.
    background: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PushProgressEvent {
    repo_id: String,
    current: u32,
    total: u32,
    bytes: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AutostashConflictEvent {
    repo_id: String,
    paths: Vec<String>,
}

/// Rare edge case: the rebase itself completed fine, but re-applying the
/// changes autostash tucked away beforehand conflicted with it. Surfaced as
/// a toast via this event rather than folded into `RebaseStatus` — it's a
/// working-directory conflict, not a rebase-step conflict, so it doesn't fit
/// that shape and the existing stash-pop conflict handling already resolves
/// this the same way (manual fix, then stage + commit as usual).
fn emit_autostash_conflicts(
    app_handle: &tauri::AppHandle,
    repo_id: &str,
    conflicts: Vec<rebase::ConflictedFile>,
) {
    if conflicts.is_empty() {
        return;
    }
    let _ = app_handle.emit(
        "git://autostash-conflict",
        AutostashConflictEvent {
            repo_id: repo_id.to_string(),
            paths: conflicts.into_iter().map(|c| c.path).collect(),
        },
    );
}

/// Fetch progress as `git://fetch-progress` events, throttled to one per 100ms.
fn fetch_progress(
    app_handle: &tauri::AppHandle,
    repo_id: &str,
    background: bool,
) -> impl FnMut(usize, usize, usize) + 'static {
    let emit_handle = app_handle.clone();
    let emit_repo_id = repo_id.to_string();
    let mut last_emit = Instant::now();
    move |received, total, bytes| {
        if last_emit.elapsed().as_millis() >= 100 {
            let _ = emit_handle.emit(
                "git://fetch-progress",
                FetchProgressEvent {
                    repo_id: emit_repo_id.clone(),
                    received_objects: received,
                    total_objects: total,
                    received_bytes: bytes,
                    background,
                },
            );
            last_emit = Instant::now();
        }
    }
}

pub enum RepoCommand {
    Status(oneshot::Sender<Result<RepoStatus, GitCommandError>>),
    Log(
        LogQuery,
        oneshot::Sender<Result<CommitLogPage, GitCommandError>>,
    ),
    Diff(String, oneshot::Sender<Result<CommitDiff, GitCommandError>>),
    RangeDiff(
        RangeDiffArgs,
        oneshot::Sender<Result<CommitDiff, GitCommandError>>,
    ),
    GetFileContent(
        FileContentArgs,
        oneshot::Sender<Result<String, GitCommandError>>,
    ),
    ListBranches(oneshot::Sender<Result<Vec<BranchInfo>, GitCommandError>>),
    ListTags(oneshot::Sender<Result<Vec<TagInfo>, GitCommandError>>),
    Tag(TagOp, oneshot::Sender<Result<Vec<String>, GitCommandError>>),
    CreateBranch(
        CreateBranchArgs,
        oneshot::Sender<Result<BranchInfo, GitCommandError>>,
    ),
    CheckoutBranch(String, oneshot::Sender<Result<RepoStatus, GitCommandError>>),
    CheckoutAt(
        CheckoutAtArgs,
        oneshot::Sender<Result<RepoStatus, GitCommandError>>,
    ),
    StartRebase(
        String,
        oneshot::Sender<Result<RebaseStatus, GitCommandError>>,
    ),
    GetRebaseStatus(oneshot::Sender<Result<Option<RebaseStatus>, GitCommandError>>),
    ResolveRebaseConflict(
        String,
        ConflictResolution,
        oneshot::Sender<Result<RebaseStatus, GitCommandError>>,
    ),
    ContinueRebase(oneshot::Sender<Result<RebaseStatus, GitCommandError>>),
    AbortRebase(oneshot::Sender<Result<(), GitCommandError>>),
    /// `None`: every remote.
    Fetch(
        Option<String>,
        AuthMode,
        oneshot::Sender<Result<FetchSummary, GitCommandError>>,
    ),
    Push(
        PushArgs,
        oneshot::Sender<Result<PushSummary, GitCommandError>>,
    ),
    Pull(
        Option<PullStrategy>,
        oneshot::Sender<Result<PullResult, GitCommandError>>,
    ),
    GetUpstreamStatus(oneshot::Sender<Result<Option<UpstreamStatus>, GitCommandError>>),
    StashSave(
        StashSaveArgs,
        oneshot::Sender<Result<StashInfo, GitCommandError>>,
    ),
    StashList(oneshot::Sender<Result<Vec<StashInfo>, GitCommandError>>),
    StashPop(
        usize,
        oneshot::Sender<Result<StashPopResult, GitCommandError>>,
    ),
    StashApply(
        usize,
        oneshot::Sender<Result<StashPopResult, GitCommandError>>,
    ),
    StashDrop(usize, oneshot::Sender<Result<(), GitCommandError>>),
    GetWorkingStatus(oneshot::Sender<Result<WorkingStatus, GitCommandError>>),
    StagePath(String, oneshot::Sender<Result<(), GitCommandError>>),
    StageAll(oneshot::Sender<Result<(), GitCommandError>>),
    UnstagePath(String, oneshot::Sender<Result<(), GitCommandError>>),
    UnstageAll(oneshot::Sender<Result<(), GitCommandError>>),
    DiscardPath(String, oneshot::Sender<Result<(), GitCommandError>>),
    DiscardAll(oneshot::Sender<Result<(), GitCommandError>>),
    GetWorkdirDiff(bool, oneshot::Sender<Result<CommitDiff, GitCommandError>>),
    CommitChanges(
        CommitChangesArgs,
        oneshot::Sender<Result<String, GitCommandError>>,
    ),
    AmendMessage(
        AmendMessageArgs,
        oneshot::Sender<Result<CommitNode, GitCommandError>>,
    ),
    StagedUnits(oneshot::Sender<Result<super::compose::StagedUnits, GitCommandError>>),
    ApplyCompose(ComposeArgs, oneshot::Sender<Result<Vec<String>, GitCommandError>>),
    GetHeadCommit(oneshot::Sender<Result<Option<CommitNode>, GitCommandError>>),
    GetCommitSignature(
        String,
        oneshot::Sender<Result<Option<signing::CommitSignature>, GitCommandError>>,
    ),
    GetStats(oneshot::Sender<Result<RepoStats, GitCommandError>>),
    GetReflog(String, oneshot::Sender<Result<Vec<ReflogEntry>, GitCommandError>>),
    CheckoutCommitDetached(String, oneshot::Sender<Result<RepoStatus, GitCommandError>>),
    CherryPick(
        CherryPickArgs,
        oneshot::Sender<Result<CherryPickResult, GitCommandError>>,
    ),
    ResetToCommit(
        ResetToCommitArgs,
        oneshot::Sender<Result<RepoStatus, GitCommandError>>,
    ),
    ResetToRef(
        ResetToRefArgs,
        oneshot::Sender<Result<RepoStatus, GitCommandError>>,
    ),
    SyncBranchToRemote(
        String,
        oneshot::Sender<Result<StashPopResult, GitCommandError>>,
    ),
    GetRemoteUrl(
        String,
        oneshot::Sender<Result<Option<String>, GitCommandError>>,
    ),
    ListRemotes(oneshot::Sender<Result<Vec<RemoteInfo>, GitCommandError>>),
    Remote(RemoteOp, oneshot::Sender<Result<Vec<RemoteInfo>, GitCommandError>>),
    DeleteLocalBranch(String, oneshot::Sender<Result<(), GitCommandError>>),
    DeleteRemoteBranch(
        DeleteRemoteBranchArgs,
        oneshot::Sender<Result<(), GitCommandError>>,
    ),
    DeleteBranchBoth(
        DeleteRemoteBranchArgs,
        oneshot::Sender<Result<(), GitCommandError>>,
    ),
    MergeBranch(
        String,
        oneshot::Sender<Result<MergeResult, GitCommandError>>,
    ),
    Undo(oneshot::Sender<Result<String, GitCommandError>>),
    Redo(oneshot::Sender<Result<String, GitCommandError>>),
    GetUndoStatus(oneshot::Sender<Result<UndoStatus, GitCommandError>>),
}

fn short(sha: &str) -> &str {
    &sha[..sha.len().min(7)]
}

/// How a local, state-changing command shows up in the undo history, and
/// whether it continues an operation already in progress (rebase/merge
/// conflict handling). `None` for reads and for remote-only actions (fetch,
/// push, deleting a remote branch), which undo can't take back.
fn undo_label(cmd: &RepoCommand) -> Option<(String, bool)> {
    let label = match cmd {
        RepoCommand::CreateBranch(a, _) => format!("Create branch {}", a.name),
        RepoCommand::CheckoutBranch(name, _) => format!("Checkout {name}"),
        RepoCommand::CheckoutAt(a, _) => format!("Checkout {} at {}", a.name, short(&a.target_sha)),
        RepoCommand::StartRebase(onto, _) => format!("Rebase onto {onto}"),
        RepoCommand::ResolveRebaseConflict(..)
        | RepoCommand::ContinueRebase(_)
        | RepoCommand::AbortRebase(_) => return Some(("Resolve conflicts".into(), true)),
        RepoCommand::StashSave(..) => "Stash changes".into(),
        RepoCommand::StashPop(i, _) => format!("Pop stash@{{{i}}}"),
        RepoCommand::StashApply(i, _) => format!("Apply stash@{{{i}}}"),
        RepoCommand::StashDrop(i, _) => format!("Delete stash@{{{i}}}"),
        RepoCommand::StagePath(path, _) => format!("Stage {path}"),
        RepoCommand::StageAll(_) => "Stage all changes".into(),
        RepoCommand::UnstagePath(path, _) => format!("Unstage {path}"),
        RepoCommand::UnstageAll(_) => "Unstage all changes".into(),
        RepoCommand::DiscardPath(path, _) => format!("Discard changes in {path}"),
        RepoCommand::DiscardAll(_) => "Discard all changes".into(),
        RepoCommand::CommitChanges(a, _) if a.amend => format!("Amend commit \"{}\"", a.summary),
        RepoCommand::CommitChanges(a, _) => format!("Commit \"{}\"", a.summary),
        RepoCommand::ApplyCompose(a, _) => format!("Compose {} commits", a.commits.len()),
        RepoCommand::AmendMessage(a, _) => format!("Reword {}", short(&a.sha)),
        RepoCommand::CheckoutCommitDetached(sha, _) => format!("Checkout {}", short(sha)),
        RepoCommand::CherryPick(a, _) => format!("Cherry-pick {}", short(&a.sha)),
        RepoCommand::ResetToCommit(a, _) => format!("Reset to {}", short(&a.sha)),
        RepoCommand::ResetToRef(a, _) => format!("Reset to {}", a.ref_name),
        RepoCommand::SyncBranchToRemote(..) => "Sync branch with remote".into(),
        RepoCommand::DeleteLocalBranch(name, _) => format!("Delete branch {name}"),
        RepoCommand::DeleteBranchBoth(a, _) => format!("Delete branch {} (local copy)", a.branch),
        RepoCommand::MergeBranch(name, _) => format!("Merge {name}"),
        // Undo puts the branch back; the fetched remote refs stay.
        RepoCommand::Pull(..) => "Pull".into(),
        _ => return None,
    };
    Some((label, false))
}

/// Tag operations; they reply with the remote's tag names for `ListRemote`
/// and an empty list otherwise. Not part of undo history (undo doesn't
/// snapshot tags).
pub enum TagOp {
    Create { name: String, sha: String },
    DeleteLocal(String),
    Push { remote: String, name: String },
    DeleteRemote { remote: String, name: String },
    ListRemote(String),
}

/// Remote configuration changes; they reply with the updated remote list.
/// Not part of undo history (undo doesn't snapshot config).
pub enum RemoteOp {
    Add { name: String, url: String },
    Remove(String),
    Rename { from: String, to: String },
    SetUrl { name: String, url: String },
}

pub struct DeleteRemoteBranchArgs {
    pub remote_name: String,
    pub branch: String,
}

pub struct ResetToCommitArgs {
    pub sha: String,
    pub hard: bool,
}

pub struct ResetToRefArgs {
    pub ref_name: String,
    pub hard: bool,
}

pub struct CherryPickArgs {
    pub sha: String,
    pub create_commit: bool,
}

pub struct CommitChangesArgs {
    pub summary: String,
    pub body: String,
    pub author_name: Option<String>,
    pub author_email: Option<String>,
    pub amend: bool,
    pub no_verify: bool,
}

pub struct ComposeArgs {
    pub tree_id: String,
    pub commits: Vec<super::compose::ComposedCommitInput>,
    pub author_name: Option<String>,
    pub author_email: Option<String>,
    pub no_verify: bool,
}

pub struct AmendMessageArgs {
    pub sha: String,
    pub summary: String,
    pub body: String,
    pub no_verify: bool,
}

pub struct RangeDiffArgs {
    pub from_sha: String,
    pub to_sha: String,
}

pub struct FileContentArgs {
    pub sha: Option<String>,
    pub path: String,
}

pub struct StashSaveArgs {
    pub message: Option<String>,
    pub include_untracked: bool,
}

pub struct CreateBranchArgs {
    pub name: String,
    pub start_point: Option<String>,
    pub checkout: bool,
}

pub struct CheckoutAtArgs {
    pub name: String,
    pub target_sha: String,
    pub remote_name: Option<String>,
}

pub struct PushArgs {
    /// `None`: where `git push` would go (see `remote::push_remote_for`).
    pub remote_name: Option<String>,
    pub branch: String,
    pub force: bool,
}

#[derive(Clone)]
pub struct RepoActor {
    tx: mpsc::Sender<RepoCommand>,
}

impl RepoActor {
    pub fn spawn(
        mut repo: git2::Repository,
        app_handle: tauri::AppHandle,
        repo_id: String,
    ) -> Self {
        let (tx, rx) = mpsc::channel::<RepoCommand>();
        std::thread::spawn(move || {
            let mut history = UndoHistory::default();
            for cmd in rx {
                // Snapshot around every local mutation so it can be undone.
                // A failed snapshot just means this action isn't undoable.
                let recording = undo_label(&cmd)
                    .and_then(|(label, cont)| Some((label, cont, undo::capture(&mut repo).ok()?)));
                match cmd {
                    RepoCommand::Undo(reply) => {
                        let _ = reply.send(history.undo(&mut repo));
                    }
                    RepoCommand::Redo(reply) => {
                        let _ = reply.send(history.redo(&mut repo));
                    }
                    RepoCommand::GetUndoStatus(reply) => {
                        let _ = reply.send(Ok(history.status()));
                    }
                    RepoCommand::Status(reply) => {
                        let _ = reply.send(repo::status(&repo));
                    }
                    RepoCommand::Log(query, reply) => {
                        let _ = reply.send(log::commit_log(&repo, &query));
                    }
                    RepoCommand::Diff(sha, reply) => {
                        let _ = reply.send(diff::commit_diff(&repo, &sha));
                    }
                    RepoCommand::RangeDiff(args, reply) => {
                        let _ = reply.send(diff::range_diff(&repo, &args.from_sha, &args.to_sha));
                    }
                    RepoCommand::GetFileContent(args, reply) => {
                        let _ = reply.send(diff::read_file_base64(
                            &repo,
                            args.sha.as_deref(),
                            &args.path,
                        ));
                    }
                    RepoCommand::ListBranches(reply) => {
                        let _ = reply.send(branch::list_branches(&repo));
                    }
                    RepoCommand::ListTags(reply) => {
                        let _ = reply.send(branch::list_tags(&repo));
                    }
                    RepoCommand::Tag(op, reply) => {
                        let result = match op {
                            TagOp::Create { name, sha } => {
                                branch::create_tag(&repo, &name, &sha).map(|_| Vec::new())
                            }
                            TagOp::DeleteLocal(name) => {
                                branch::delete_local_tag(&repo, &name).map(|_| Vec::new())
                            }
                            TagOp::Push { remote, name } => {
                                remote::push_tag(&repo, &remote, &name).map(|_| Vec::new())
                            }
                            TagOp::DeleteRemote { remote, name } => {
                                remote::delete_remote_tag(&repo, &remote, &name).map(|_| Vec::new())
                            }
                            TagOp::ListRemote(remote) => remote::list_remote_tags(&repo, &remote),
                        };
                        let _ = reply.send(result);
                    }
                    RepoCommand::CreateBranch(args, reply) => {
                        let _ = reply.send(branch::create_branch(
                            &repo,
                            &args.name,
                            args.start_point.as_deref(),
                            args.checkout,
                        ));
                    }
                    RepoCommand::CheckoutBranch(name, reply) => {
                        let result =
                            branch::checkout_branch(&repo, &name).and_then(|_| repo::status(&repo));
                        let _ = reply.send(result);
                    }
                    RepoCommand::CheckoutAt(args, reply) => {
                        let result = branch::checkout_at(
                            &repo,
                            &args.name,
                            &args.target_sha,
                            args.remote_name.as_deref(),
                        )
                        .and_then(|_| repo::status(&repo));
                        let _ = reply.send(result);
                    }
                    // Rebase sessions are never kept in memory across commands: `Rebase<'_>`
                    // borrows `repo`, and holding that borrow across loop iterations would
                    // permanently block the `&mut repo` stash operations need. libgit2
                    // already persists rebase state to `.git/rebase-merge` between calls, so
                    // each command just reopens it fresh via `repo.open_rebase(None)`.
                    RepoCommand::StartRebase(onto, reply) => {
                        let result = if rebase::is_rebase_in_progress(&repo) {
                            Err(GitCommandError::Internal(
                                "a rebase is already in progress in this repository".into(),
                            ))
                        } else {
                            (|| -> Result<RebaseStatus, GitCommandError> {
                                if rebase::has_uncommitted_changes(&repo)? {
                                    rebase::autostash(&mut repo)?;
                                }
                                let status =
                                    rebase::start(&repo, &onto).map(|(_session, status)| status)?;
                                if matches!(status.state, rebase::RebaseState::Complete) {
                                    let conflicts = rebase::pop_autostash_if_any(&mut repo)?;
                                    emit_autostash_conflicts(&app_handle, &repo_id, conflicts);
                                }
                                Ok(status)
                            })()
                        };
                        let _ = reply.send(result);
                    }
                    RepoCommand::GetRebaseStatus(reply) => {
                        let _ = reply.send(rebase::read_status(&repo));
                    }
                    RepoCommand::ResolveRebaseConflict(path, resolution, reply) => {
                        let result =
                            rebase::resolve_conflict(&repo, &path, resolution).and_then(|_| {
                                // `None` here just means nothing is conflicted anymore and
                                // there's no rebase session to report on (e.g. this conflict
                                // came from a stash apply, not a rebase) — that's success,
                                // not an error condition.
                                Ok(rebase::read_status(&repo)?.unwrap_or(RebaseStatus {
                                    state: rebase::RebaseState::Complete,
                                    current_step: 0,
                                    total_steps: 0,
                                    conflicts: Vec::new(),
                                }))
                            });
                        let _ = reply.send(result);
                    }
                    RepoCommand::ContinueRebase(reply) => {
                        let result = (|| -> Result<RebaseStatus, GitCommandError> {
                            // Checked before `open_rebase`, which would otherwise hold an
                            // immutable borrow of `repo` across this whole match, conflicting
                            // with `continue_merge`'s need for a mutable one.
                            if repo.state() == git2::RepositoryState::Merge {
                                merge::continue_merge(&mut repo)?;
                                // A pull that merged may have autostashed first.
                                let conflicts = rebase::pop_autostash_if_any(&mut repo)?;
                                emit_autostash_conflicts(&app_handle, &repo_id, conflicts);
                                return Ok(RebaseStatus {
                                    state: rebase::RebaseState::Complete,
                                    current_step: 0,
                                    total_steps: 0,
                                    conflicts: Vec::new(),
                                });
                            }
                            let status = match repo.open_rebase(None) {
                                Ok(mut session) => rebase::advance(&repo, &mut session, true)?,
                                // Interactive rebases (or any other state libgit2 refuses to
                                // open) can't be advanced through the `Rebase` API at all —
                                // shell out to the real `git` binary instead.
                                Err(_) if rebase::is_rebase_in_progress(&repo) => {
                                    let workdir = repo.workdir().ok_or_else(|| {
                                        GitCommandError::Internal(
                                            "bare repository has no working directory".into(),
                                        )
                                    })?;
                                    external_git::rebase_continue(workdir)?;
                                    rebase::read_status(&repo)?.unwrap_or(RebaseStatus {
                                        state: rebase::RebaseState::Complete,
                                        current_step: 0,
                                        total_steps: 0,
                                        conflicts: Vec::new(),
                                    })
                                }
                                Err(_) => {
                                    return Err(GitCommandError::Internal(
                                        "no rebase in progress".into(),
                                    ))
                                }
                            };
                            if matches!(status.state, rebase::RebaseState::Complete) {
                                let conflicts = rebase::pop_autostash_if_any(&mut repo)?;
                                emit_autostash_conflicts(&app_handle, &repo_id, conflicts);
                            }
                            Ok(status)
                        })();
                        let _ = reply.send(result);
                    }
                    RepoCommand::AbortRebase(reply) => {
                        // Idempotent: nothing to abort is not an error, the panel just dismisses.
                        let result = (|| -> Result<(), GitCommandError> {
                            match repo.open_rebase(None) {
                                Ok(mut session) => rebase::abort(&mut session)?,
                                Err(_) if rebase::is_rebase_in_progress(&repo) => {
                                    if let Some(workdir) = repo.workdir() {
                                        external_git::rebase_abort(workdir)?;
                                    }
                                }
                                // Merge, cherry-pick and revert don't move HEAD until
                                // their final commit: aborting is restoring HEAD's tree.
                                Err(_)
                                    if matches!(
                                        repo.state(),
                                        git2::RepositoryState::Merge
                                            | git2::RepositoryState::CherryPick
                                            | git2::RepositoryState::CherryPickSequence
                                            | git2::RepositoryState::Revert
                                            | git2::RepositoryState::RevertSequence
                                    ) =>
                                {
                                    merge::abort_merge(&repo)?;
                                }
                                Err(_) => {}
                            }
                            let conflicts = rebase::pop_autostash_if_any(&mut repo)?;
                            emit_autostash_conflicts(&app_handle, &repo_id, conflicts);
                            Ok(())
                        })();
                        let _ = reply.send(result);
                    }
                    RepoCommand::Fetch(remote_name, mode, reply) => {
                        let progress =
                            fetch_progress(&app_handle, &repo_id, mode == AuthMode::Background);
                        let _ = reply.send(remote::fetch_remotes(
                            &repo,
                            remote_name.as_deref(),
                            mode,
                            progress,
                        ));
                    }
                    RepoCommand::Pull(choice, reply) => {
                        let progress = fetch_progress(&app_handle, &repo_id, false);
                        // Autostash conflicts ride in the result: the UI opens the
                        // conflict panel for them right away.
                        let _ = reply.send(pull::pull(&mut repo, choice, progress));
                    }
                    RepoCommand::GetUpstreamStatus(reply) => {
                        let _ = reply.send(pull::upstream_status(&repo));
                    }
                    RepoCommand::Push(args, reply) => {
                        let emit_handle = app_handle.clone();
                        let emit_repo_id = repo_id.clone();
                        let mut last_emit = Instant::now();
                        let remote_name = match args.remote_name {
                            Some(name) => Ok(name),
                            None => remote::push_remote_for(&repo, &args.branch),
                        };
                        let result = remote_name.and_then(|remote_name| remote::push(
                            &repo,
                            &remote_name,
                            &args.branch,
                            args.force,
                            move |current, total, bytes| {
                                if last_emit.elapsed().as_millis() >= 100 || current == total {
                                    let _ = emit_handle.emit(
                                        "git://push-progress",
                                        PushProgressEvent {
                                            repo_id: emit_repo_id.clone(),
                                            current,
                                            total,
                                            bytes,
                                        },
                                    );
                                    last_emit = Instant::now();
                                }
                            },
                        ));
                        let _ = reply.send(result);
                    }
                    RepoCommand::StashSave(args, reply) => {
                        let _ = reply.send(stash::save(
                            &mut repo,
                            args.message.as_deref(),
                            args.include_untracked,
                        ));
                    }
                    RepoCommand::StashList(reply) => {
                        let _ = reply.send(stash::list(&mut repo));
                    }
                    RepoCommand::StashPop(index, reply) => {
                        let _ = reply.send(stash::pop(&mut repo, index));
                    }
                    RepoCommand::StashApply(index, reply) => {
                        let _ = reply.send(stash::apply(&mut repo, index));
                    }
                    RepoCommand::StashDrop(index, reply) => {
                        let _ = reply.send(stash::drop(&mut repo, index));
                    }
                    RepoCommand::GetWorkingStatus(reply) => {
                        let _ = reply.send(working::working_status(&repo));
                    }
                    RepoCommand::StagePath(path, reply) => {
                        let _ = reply.send(working::stage_path(&repo, &path));
                    }
                    RepoCommand::StageAll(reply) => {
                        let _ = reply.send(working::stage_all(&repo));
                    }
                    RepoCommand::UnstagePath(path, reply) => {
                        let _ = reply.send(working::unstage_path(&repo, &path));
                    }
                    RepoCommand::UnstageAll(reply) => {
                        let _ = reply.send(working::unstage_all(&repo));
                    }
                    RepoCommand::DiscardPath(path, reply) => {
                        let _ = reply.send(working::discard_path(&repo, &path));
                    }
                    RepoCommand::DiscardAll(reply) => {
                        let _ = reply.send(working::discard_all(&repo));
                    }
                    RepoCommand::GetWorkdirDiff(staged, reply) => {
                        let _ = reply.send(diff::workdir_diff(&repo, staged));
                    }
                    RepoCommand::CommitChanges(args, reply) => {
                        let _ = reply.send(working::commit(
                            &repo,
                            &args.summary,
                            &args.body,
                            args.author_name.as_deref(),
                            args.author_email.as_deref(),
                            args.amend,
                            args.no_verify,
                        ));
                    }
                    RepoCommand::StagedUnits(reply) => {
                        let _ = reply.send(super::compose::staged_units(&repo));
                    }
                    RepoCommand::ApplyCompose(args, reply) => {
                        let _ = reply.send(super::compose::apply(
                            &repo,
                            &args.tree_id,
                            &args.commits,
                            args.author_name.as_deref(),
                            args.author_email.as_deref(),
                            args.no_verify,
                        ));
                    }
                    RepoCommand::AmendMessage(args, reply) => {
                        let _ = reply.send(working::amend_message(
                            &repo,
                            &args.sha,
                            &args.summary,
                            &args.body,
                            args.no_verify,
                        ));
                    }
                    RepoCommand::GetReflog(ref_name, reply) => {
                        let _ = reply.send(reflog::reflog(&repo, &ref_name));
                    }
                    RepoCommand::GetStats(reply) => {
                        let now = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_secs() as i64)
                            .unwrap_or(0);
                        let _ = reply.send(stats::repo_stats(&repo, now));
                    }
                    RepoCommand::GetHeadCommit(reply) => {
                        let _ = reply.send(log::head_commit(&repo));
                    }
                    RepoCommand::GetCommitSignature(sha, reply) => {
                        let _ = reply.send(signing::commit_signature(&repo, &sha));
                    }
                    RepoCommand::CheckoutCommitDetached(sha, reply) => {
                        let result = branch::checkout_detached(&repo, &sha)
                            .and_then(|_| repo::status(&repo));
                        let _ = reply.send(result);
                    }
                    RepoCommand::CherryPick(args, reply) => {
                        let _ = reply.send(cherry_pick::cherry_pick(
                            &mut repo,
                            &args.sha,
                            args.create_commit,
                        ));
                    }
                    RepoCommand::ResetToCommit(args, reply) => {
                        let result = branch::reset_to_commit(&repo, &args.sha, args.hard)
                            .and_then(|_| repo::status(&repo));
                        let _ = reply.send(result);
                    }
                    RepoCommand::ResetToRef(args, reply) => {
                        let result = branch::reset_to_ref(&repo, &args.ref_name, args.hard)
                            .and_then(|_| repo::status(&repo));
                        let _ = reply.send(result);
                    }
                    RepoCommand::SyncBranchToRemote(target_sha, reply) => {
                        let _ = reply.send(branch::sync_branch_to_commit(&mut repo, &target_sha));
                    }
                    RepoCommand::GetRemoteUrl(remote_name, reply) => {
                        let _ = reply.send(remote::get_remote_url(&repo, &remote_name));
                    }
                    RepoCommand::ListRemotes(reply) => {
                        let _ = reply.send(remote::list_remotes(&repo));
                    }
                    RepoCommand::Remote(op, reply) => {
                        let result = match op {
                            RemoteOp::Add { name, url } => remote::add_remote(&repo, &name, &url),
                            RemoteOp::Remove(name) => remote::remove_remote(&repo, &name),
                            RemoteOp::Rename { from, to } => remote::rename_remote(&repo, &from, &to),
                            RemoteOp::SetUrl { name, url } => remote::set_remote_url(&repo, &name, &url),
                        };
                        let _ = reply.send(result.and_then(|_| remote::list_remotes(&repo)));
                    }
                    RepoCommand::DeleteLocalBranch(name, reply) => {
                        let _ = reply.send(branch::delete_local_branch(&repo, &name));
                    }
                    RepoCommand::DeleteRemoteBranch(args, reply) => {
                        let _ = reply.send(remote::delete_remote_branch(
                            &repo,
                            &args.remote_name,
                            &args.branch,
                        ));
                    }
                    RepoCommand::DeleteBranchBoth(args, reply) => {
                        let result =
                            branch::delete_local_branch(&repo, &args.branch).and_then(|_| {
                                remote::delete_remote_branch(&repo, &args.remote_name, &args.branch)
                            });
                        let _ = reply.send(result);
                    }
                    RepoCommand::MergeBranch(branch_name, reply) => {
                        let _ = reply.send(merge::merge_branch(&repo, &branch_name));
                    }
                }
                if let Some((label, continuation, before)) = recording {
                    if let Ok(after) = undo::capture(&mut repo) {
                        history.record(label, before, after, continuation);
                    }
                }
            }
        });
        Self { tx }
    }

    async fn dispatch<T>(
        &self,
        make_cmd: impl FnOnce(oneshot::Sender<Result<T, GitCommandError>>) -> RepoCommand,
    ) -> Result<T, GitCommandError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(make_cmd(reply_tx))
            .map_err(|_| GitCommandError::Internal("repo actor is no longer running".into()))?;
        reply_rx
            .await
            .map_err(|_| GitCommandError::Internal("repo actor did not respond".into()))?
    }

    pub async fn undo(&self) -> Result<String, GitCommandError> {
        self.dispatch(RepoCommand::Undo).await
    }

    pub async fn redo(&self) -> Result<String, GitCommandError> {
        self.dispatch(RepoCommand::Redo).await
    }

    pub async fn undo_status(&self) -> Result<UndoStatus, GitCommandError> {
        self.dispatch(RepoCommand::GetUndoStatus).await
    }

    pub async fn status(&self) -> Result<RepoStatus, GitCommandError> {
        self.dispatch(RepoCommand::Status).await
    }

    pub async fn log(&self, query: LogQuery) -> Result<CommitLogPage, GitCommandError> {
        self.dispatch(|tx| RepoCommand::Log(query, tx)).await
    }

    pub async fn diff(&self, sha: String) -> Result<CommitDiff, GitCommandError> {
        self.dispatch(|tx| RepoCommand::Diff(sha, tx)).await
    }

    pub async fn range_diff(&self, args: RangeDiffArgs) -> Result<CommitDiff, GitCommandError> {
        self.dispatch(|tx| RepoCommand::RangeDiff(args, tx)).await
    }

    pub async fn file_content(&self, args: FileContentArgs) -> Result<String, GitCommandError> {
        self.dispatch(|tx| RepoCommand::GetFileContent(args, tx))
            .await
    }

    pub async fn list_branches(&self) -> Result<Vec<BranchInfo>, GitCommandError> {
        self.dispatch(RepoCommand::ListBranches).await
    }

    pub async fn tag(&self, op: TagOp) -> Result<Vec<String>, GitCommandError> {
        self.dispatch(|tx| RepoCommand::Tag(op, tx)).await
    }

    pub async fn list_tags(&self) -> Result<Vec<TagInfo>, GitCommandError> {
        self.dispatch(RepoCommand::ListTags).await
    }

    pub async fn create_branch(
        &self,
        args: CreateBranchArgs,
    ) -> Result<BranchInfo, GitCommandError> {
        self.dispatch(|tx| RepoCommand::CreateBranch(args, tx))
            .await
    }

    pub async fn checkout_branch(&self, name: String) -> Result<RepoStatus, GitCommandError> {
        self.dispatch(|tx| RepoCommand::CheckoutBranch(name, tx))
            .await
    }

    pub async fn checkout_at(&self, args: CheckoutAtArgs) -> Result<RepoStatus, GitCommandError> {
        self.dispatch(|tx| RepoCommand::CheckoutAt(args, tx)).await
    }

    pub async fn start_rebase(&self, onto_branch: String) -> Result<RebaseStatus, GitCommandError> {
        self.dispatch(|tx| RepoCommand::StartRebase(onto_branch, tx))
            .await
    }

    pub async fn rebase_status(&self) -> Result<Option<RebaseStatus>, GitCommandError> {
        self.dispatch(RepoCommand::GetRebaseStatus).await
    }

    pub async fn resolve_rebase_conflict(
        &self,
        path: String,
        resolution: ConflictResolution,
    ) -> Result<RebaseStatus, GitCommandError> {
        self.dispatch(|tx| RepoCommand::ResolveRebaseConflict(path, resolution, tx))
            .await
    }

    pub async fn continue_rebase(&self) -> Result<RebaseStatus, GitCommandError> {
        self.dispatch(RepoCommand::ContinueRebase).await
    }

    pub async fn abort_rebase(&self) -> Result<(), GitCommandError> {
        self.dispatch(RepoCommand::AbortRebase).await
    }

    pub async fn fetch(
        &self,
        remote_name: Option<String>,
        mode: AuthMode,
    ) -> Result<FetchSummary, GitCommandError> {
        self.dispatch(|tx| RepoCommand::Fetch(remote_name, mode, tx))
            .await
    }

    pub async fn push(&self, args: PushArgs) -> Result<PushSummary, GitCommandError> {
        self.dispatch(|tx| RepoCommand::Push(args, tx)).await
    }

    pub async fn pull(&self, choice: Option<PullStrategy>) -> Result<PullResult, GitCommandError> {
        self.dispatch(|tx| RepoCommand::Pull(choice, tx)).await
    }

    pub async fn upstream_status(&self) -> Result<Option<UpstreamStatus>, GitCommandError> {
        self.dispatch(RepoCommand::GetUpstreamStatus).await
    }

    pub async fn stash_save(&self, args: StashSaveArgs) -> Result<StashInfo, GitCommandError> {
        self.dispatch(|tx| RepoCommand::StashSave(args, tx)).await
    }

    pub async fn stash_list(&self) -> Result<Vec<StashInfo>, GitCommandError> {
        self.dispatch(RepoCommand::StashList).await
    }

    pub async fn stash_pop(&self, index: usize) -> Result<StashPopResult, GitCommandError> {
        self.dispatch(|tx| RepoCommand::StashPop(index, tx)).await
    }

    pub async fn stash_apply(&self, index: usize) -> Result<StashPopResult, GitCommandError> {
        self.dispatch(|tx| RepoCommand::StashApply(index, tx)).await
    }

    pub async fn stash_drop(&self, index: usize) -> Result<(), GitCommandError> {
        self.dispatch(|tx| RepoCommand::StashDrop(index, tx)).await
    }

    pub async fn working_status(&self) -> Result<WorkingStatus, GitCommandError> {
        self.dispatch(RepoCommand::GetWorkingStatus).await
    }

    pub async fn stage_path(&self, path: String) -> Result<(), GitCommandError> {
        self.dispatch(|tx| RepoCommand::StagePath(path, tx)).await
    }

    pub async fn stage_all(&self) -> Result<(), GitCommandError> {
        self.dispatch(RepoCommand::StageAll).await
    }

    pub async fn unstage_path(&self, path: String) -> Result<(), GitCommandError> {
        self.dispatch(|tx| RepoCommand::UnstagePath(path, tx)).await
    }

    pub async fn unstage_all(&self) -> Result<(), GitCommandError> {
        self.dispatch(RepoCommand::UnstageAll).await
    }

    pub async fn discard_path(&self, path: String) -> Result<(), GitCommandError> {
        self.dispatch(|tx| RepoCommand::DiscardPath(path, tx)).await
    }

    pub async fn discard_all(&self) -> Result<(), GitCommandError> {
        self.dispatch(RepoCommand::DiscardAll).await
    }

    pub async fn workdir_diff(&self, staged: bool) -> Result<CommitDiff, GitCommandError> {
        self.dispatch(|tx| RepoCommand::GetWorkdirDiff(staged, tx))
            .await
    }

    pub async fn commit_changes(&self, args: CommitChangesArgs) -> Result<String, GitCommandError> {
        self.dispatch(|tx| RepoCommand::CommitChanges(args, tx))
            .await
    }

    pub async fn staged_units(&self) -> Result<super::compose::StagedUnits, GitCommandError> {
        self.dispatch(RepoCommand::StagedUnits).await
    }

    pub async fn apply_compose(&self, args: ComposeArgs) -> Result<Vec<String>, GitCommandError> {
        self.dispatch(|tx| RepoCommand::ApplyCompose(args, tx)).await
    }

    pub async fn amend_message(
        &self,
        args: AmendMessageArgs,
    ) -> Result<CommitNode, GitCommandError> {
        self.dispatch(|tx| RepoCommand::AmendMessage(args, tx))
            .await
    }

    pub async fn head_commit(&self) -> Result<Option<CommitNode>, GitCommandError> {
        self.dispatch(RepoCommand::GetHeadCommit).await
    }

    pub async fn commit_signature(
        &self,
        sha: String,
    ) -> Result<Option<signing::CommitSignature>, GitCommandError> {
        self.dispatch(|tx| RepoCommand::GetCommitSignature(sha, tx)).await
    }

    pub async fn stats(&self) -> Result<RepoStats, GitCommandError> {
        self.dispatch(RepoCommand::GetStats).await
    }

    pub async fn reflog(&self, ref_name: String) -> Result<Vec<ReflogEntry>, GitCommandError> {
        self.dispatch(|tx| RepoCommand::GetReflog(ref_name, tx)).await
    }

    pub async fn checkout_commit_detached(
        &self,
        sha: String,
    ) -> Result<RepoStatus, GitCommandError> {
        self.dispatch(|tx| RepoCommand::CheckoutCommitDetached(sha, tx))
            .await
    }

    pub async fn cherry_pick(
        &self,
        args: CherryPickArgs,
    ) -> Result<CherryPickResult, GitCommandError> {
        self.dispatch(|tx| RepoCommand::CherryPick(args, tx)).await
    }

    pub async fn reset_to_commit(
        &self,
        args: ResetToCommitArgs,
    ) -> Result<RepoStatus, GitCommandError> {
        self.dispatch(|tx| RepoCommand::ResetToCommit(args, tx))
            .await
    }

    pub async fn reset_to_ref(&self, args: ResetToRefArgs) -> Result<RepoStatus, GitCommandError> {
        self.dispatch(|tx| RepoCommand::ResetToRef(args, tx)).await
    }

    pub async fn sync_branch_to_remote(
        &self,
        target_sha: String,
    ) -> Result<StashPopResult, GitCommandError> {
        self.dispatch(|tx| RepoCommand::SyncBranchToRemote(target_sha, tx))
            .await
    }

    pub async fn get_remote_url(
        &self,
        remote_name: String,
    ) -> Result<Option<String>, GitCommandError> {
        self.dispatch(|tx| RepoCommand::GetRemoteUrl(remote_name, tx))
            .await
    }

    pub async fn list_remotes(&self) -> Result<Vec<RemoteInfo>, GitCommandError> {
        self.dispatch(RepoCommand::ListRemotes).await
    }

    pub async fn remote(&self, op: RemoteOp) -> Result<Vec<RemoteInfo>, GitCommandError> {
        self.dispatch(|tx| RepoCommand::Remote(op, tx)).await
    }

    pub async fn delete_local_branch(&self, name: String) -> Result<(), GitCommandError> {
        self.dispatch(|tx| RepoCommand::DeleteLocalBranch(name, tx))
            .await
    }

    pub async fn delete_remote_branch(
        &self,
        args: DeleteRemoteBranchArgs,
    ) -> Result<(), GitCommandError> {
        self.dispatch(|tx| RepoCommand::DeleteRemoteBranch(args, tx))
            .await
    }

    pub async fn delete_branch_both(
        &self,
        args: DeleteRemoteBranchArgs,
    ) -> Result<(), GitCommandError> {
        self.dispatch(|tx| RepoCommand::DeleteBranchBoth(args, tx))
            .await
    }

    pub async fn merge_branch(&self, branch_name: String) -> Result<MergeResult, GitCommandError> {
        self.dispatch(|tx| RepoCommand::MergeBranch(branch_name, tx))
            .await
    }
}
