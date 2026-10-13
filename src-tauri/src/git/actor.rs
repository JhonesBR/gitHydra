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
use super::rebase::{self, ConflictResolution, RebaseStatus};
use super::remote::{self, FetchSummary, PushSummary};
use super::repo::{self, RepoStatus};
use super::stash::{self, StashInfo, StashPopResult};
use super::working::{self, WorkingStatus};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FetchProgressEvent {
    repo_id: String,
    received_objects: usize,
    total_objects: usize,
    received_bytes: usize,
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
    Fetch(
        String,
        oneshot::Sender<Result<FetchSummary, GitCommandError>>,
    ),
    Push(
        PushArgs,
        oneshot::Sender<Result<PushSummary, GitCommandError>>,
    ),
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
    GetHeadCommit(oneshot::Sender<Result<Option<CommitNode>, GitCommandError>>),
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
}

pub struct AmendMessageArgs {
    pub sha: String,
    pub summary: String,
    pub body: String,
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
    pub remote_name: String,
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
            for cmd in rx {
                match cmd {
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
                                Err(_) if repo.state() == git2::RepositoryState::Merge => {
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
                    RepoCommand::Fetch(remote_name, reply) => {
                        let emit_handle = app_handle.clone();
                        let emit_repo_id = repo_id.clone();
                        let mut last_emit = Instant::now();
                        let result =
                            remote::fetch(&repo, &remote_name, move |received, total, bytes| {
                                if last_emit.elapsed().as_millis() >= 100 {
                                    let _ = emit_handle.emit(
                                        "git://fetch-progress",
                                        FetchProgressEvent {
                                            repo_id: emit_repo_id.clone(),
                                            received_objects: received,
                                            total_objects: total,
                                            received_bytes: bytes,
                                        },
                                    );
                                    last_emit = Instant::now();
                                }
                            });
                        let _ = reply.send(result);
                    }
                    RepoCommand::Push(args, reply) => {
                        let emit_handle = app_handle.clone();
                        let emit_repo_id = repo_id.clone();
                        let mut last_emit = Instant::now();
                        let result = remote::push(
                            &repo,
                            &args.remote_name,
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
                        );
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
                        ));
                    }
                    RepoCommand::AmendMessage(args, reply) => {
                        let _ = reply.send(working::amend_message(
                            &repo,
                            &args.sha,
                            &args.summary,
                            &args.body,
                        ));
                    }
                    RepoCommand::GetHeadCommit(reply) => {
                        let _ = reply.send(log::head_commit(&repo));
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

    pub async fn fetch(&self, remote_name: String) -> Result<FetchSummary, GitCommandError> {
        self.dispatch(|tx| RepoCommand::Fetch(remote_name, tx))
            .await
    }

    pub async fn push(&self, args: PushArgs) -> Result<PushSummary, GitCommandError> {
        self.dispatch(|tx| RepoCommand::Push(args, tx)).await
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
