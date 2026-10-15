import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ChevronUp,
  CircleX,
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ResizableSidebar } from "@/components/ResizableSidebar";
import { BranchSidebar } from "@/features/branches/BranchSidebar";
import { lazyNamed } from "@/lib/lazy";
import { useUndo } from "@/features/undo/useUndo";
import { getHeadCommit } from "@/features/commit-graph/api";
import { useShortcut } from "@/features/shortcuts/useShortcuts";
import { CommitGraph } from "@/features/commit-graph/CommitGraph";
import type { GraphSelection } from "@/features/commit-graph/types";
import { CommitDetailsPanel } from "@/features/diff-viewer/CommitDetailsPanel";
import { MultiCommitDetailsPanel } from "@/features/diff-viewer/MultiCommitDetailsPanel";
import type { FileDiff } from "@/features/diff-viewer/types";
import { openBlame, openFileHistory } from "@/features/history/store";
import { LfsBanner } from "@/features/lfs/LfsBanner";
import { getRebaseStatus } from "@/features/rebase/api";
import { RebaseConflictPanel } from "@/features/rebase/RebaseConflictPanel";
import { useResolveConflict } from "@/features/rebase/useResolveConflict";
import { useRebaseStore } from "@/features/rebase/store";
import { fetchRemote } from "@/features/remote-ops/api";
import { refreshAfterBackgroundFetch } from "@/features/remote-ops/useAutoFetch";
import { StashDetailsPanel } from "@/features/stash/StashDetailsPanel";

// Heavy views load on first use: xterm, the diff/syntax stack and the
// statistics/tree views stay out of the startup bundle.
const CommitTreeView = lazyNamed(() => import("@/features/commit-tree/CommitTreeView"), "CommitTreeView");
const ReflogView = lazyNamed(() => import("@/features/reflog/ReflogView"), "ReflogView");
const StatisticsView = lazyNamed(() => import("@/features/statistics/StatisticsView"), "StatisticsView");
const HistoryViewHost = lazyNamed(() => import("@/features/history/HistoryViewHost"), "HistoryViewHost");
const FileDiffFullView = lazyNamed(() => import("@/features/diff-viewer/FileDiffFullView"), "FileDiffFullView");
const ConflictResolutionView = lazyNamed(
  () => import("@/features/rebase/ConflictResolutionView"),
  "ConflictResolutionView",
);
const TerminalPanel = lazyNamed(() => import("@/features/terminal/TerminalPanel"), "TerminalPanel");
import { StagingPanel } from "@/features/working/StagingPanel";
import type { WorkingSide } from "@/features/working/types";
import { confirm } from "@/lib/confirm-store";
import { queryKeys } from "@/lib/query-keys";
import { usePersistedValue } from "@/lib/use-persisted-config";
import type { RepoStatus, RepoSummary } from "./api";
import { getRepoStatus } from "./api";
import { useTabsStore } from "./store";
import { TopBar } from "./TopBar";
import { useRepoPolling } from "./useRepoPolling";

const IN_PROGRESS_LABELS: Record<NonNullable<RepoStatus["inProgressOp"]>, string> = {
  Rebase: "Rebase",
  Merge: "Merge",
  CherryPick: "Cherry-pick",
  Revert: "Revert",
};

export function RepoView({ tabId, repo }: { tabId: string; repo: RepoSummary }) {
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const rebaseStatus = useRebaseStore((s) => s.status);
  const setRebaseStatus = useRebaseStore((s) => s.setStatus);
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<GraphSelection>(null);
  const [openFile, setOpenFile] = useState<FileDiff | null>(null);
  // Only meaningful for working-copy files (set by the staging panel).
  const [openFileSide, setOpenFileSide] = useState<WorkingSide | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [branchesOpen, setBranchesOpen] = usePersistedValue("sidebar.branchesOpen", true);
  // Right-hand details panel can be tucked away (e.g. to read a diff at full
  // width); picking something new in the graph brings it back.
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [treeOpen, setTreeOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [reflogOpen, setReflogOpen] = useState(false);
  const [terminalEverOpened, setTerminalEverOpened] = useState(false);
  const [openConflictPath, setOpenConflictPath] = useState<string | null>(null);
  const showRebaseConflicts = rebaseStatus?.state === "Conflicts";

  useEffect(() => {
    if (!showRebaseConflicts) setOpenConflictPath(null);
  }, [showRebaseConflicts]);

  const { data: status } = useQuery({
    queryKey: queryKeys.repoStatus(repo.repoId),
    queryFn: () => getRepoStatus(repo.repoId),
  });
  const { data: headCommit } = useQuery({
    queryKey: queryKeys.headCommit(repo.repoId),
    queryFn: () => getHeadCommit(repo.repoId),
  });

  useEffect(() => {
    // Sync with the backend's real rebase state instead of trusting only past
    // mutation results — covers a lost/stale in-memory session on either side.
    getRebaseStatus(repo.repoId).then(setRebaseStatus);
  }, [repo, setRebaseStatus]);

  useEffect(() => {
    // Best-effort fetch of every remote: a repo with no remote (or no network,
    // or an SSH key / HTTPS remote whose secret wasn't given yet — background
    // fetches never ask) shouldn't block opening it, so failures here are
    // silent. Background fetches show no progress toast.
    // Up-to-date repos (the usual case) don't reload the log they just loaded.
    fetchRemote(repo.repoId, null, { background: true })
      .catch(() => null)
      .then((summary) => refreshAfterBackgroundFetch(queryClient, repo.repoId, summary));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.repoId]);

  useRepoPolling(repo.repoId, tabId === activeTabId);

  // Auto-select local changes on open, once per repo — but never fight a
  // deliberate deselect, so this only fires the first time status loads.
  const autoSelectedRepoId = useRef<string | null>(null);
  useEffect(() => {
    if (status === undefined) return;
    if (autoSelectedRepoId.current === repo.repoId) return;
    autoSelectedRepoId.current = repo.repoId;
    const hasChanges = (status.dirtyFiles + status.stagedFiles) > 0;
    if (hasChanges) setSelected({ kind: "wip" });
  }, [repo, status]);

  const undo = useUndo(repo.repoId, tabId === activeTabId);

  const { abort: abortOperation } = useResolveConflict(repo.repoId);
  const abortInProgress = async () => {
    const op = status?.inProgressOp;
    if (!op) return;
    const name = IN_PROGRESS_LABELS[op].toLowerCase();
    const confirmed = await confirm(
      `Abort the ${name}? Conflict resolutions and changes made during it are discarded and the branch goes back to where it was before the ${name}. You can still undo this with Ctrl+Z.`,
      { title: `Abort ${name}`, kind: "warning" },
    );
    if (!confirmed) return;
    await abortOperation();
    toast.success(`${IN_PROGRESS_LABELS[op]} aborted`);
  };

  const toggleTerminal = () => {
    setTerminalEverOpened(true);
    setTerminalOpen((o) => !o);
  };

  useShortcut(
    "toggleTerminal",
    (e) => {
      e.preventDefault();
      toggleTerminal();
    },
    tabId === activeTabId,
  );

  const hasLocalChanges = ((status?.dirtyFiles ?? 0) + (status?.stagedFiles ?? 0)) > 0;
  const openFileSha =
    selected?.kind === "commit"
      ? selected.commit.sha
      : selected?.kind === "commits"
        ? selected.toSha
        : selected?.kind === "stash"
          ? selected.stash.sha
          : null;
  const showStaging = selected?.kind === "wip" || (selected === null && hasLocalChanges);
  const showCommitDetails = selected?.kind === "commit";
  const showMultiCommitDetails = selected?.kind === "commits";
  const showStashDetails = selected?.kind === "stash";
  const hasDetailsPanel =
    showRebaseConflicts || showStaging || showCommitDetails || showMultiCommitDetails || showStashDetails;

  return (
    <main className="flex h-full w-full flex-col overflow-hidden bg-neutral-950 text-neutral-100">
      <TopBar
        repoId={repo.repoId}
        repoPath={repo.path}
        branch={status?.currentBranch ?? null}
        hasLocalChanges={hasLocalChanges}
        onOpenTree={() => setTreeOpen(true)}
        onOpenStats={() => setStatsOpen(true)}
        onOpenReflog={() => setReflogOpen(true)}
        undo={undo}
      />
      <LfsBanner repoId={repo.repoId} repoPath={repo.path} />
      {statsOpen && <StatisticsView repoId={repo.repoId} onClose={() => setStatsOpen(false)} />}
      {reflogOpen && (
        <ReflogView
          repoId={repo.repoId}
          currentBranch={status?.currentBranch ?? null}
          hasLocalChanges={hasLocalChanges}
          onClose={() => setReflogOpen(false)}
        />
      )}
      <HistoryViewHost
        repoId={repo.repoId}
        active={tabId === activeTabId}
        onSelectCommit={(commit) => {
          setSelected({ kind: "commit", commit });
          setOpenFile(null);
          setDetailsOpen(true);
        }}
      />
      {treeOpen && (
        <CommitTreeView
          repoId={repo.repoId}
          onClose={() => setTreeOpen(false)}
          onOpenCommit={(commit) => {
            // Double-clicking a node jumps back to the graph with that commit open.
            setSelected({ kind: "commit", commit });
            setOpenFile(null);
            setDetailsOpen(true);
            setTreeOpen(false);
          }}
        />
      )}

      <div className="flex items-center justify-between px-4 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setBranchesOpen(!branchesOpen)}
              title={branchesOpen ? "Hide branches panel" : "Show branches panel"}
              className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            >
              {branchesOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            </button>
            <span
              className="inline-flex min-w-0 items-center gap-1.5 rounded px-2 py-0.5 text-base font-semibold"
              style={{
                // Same --head-color as the HEAD line and pill in the graph.
                color: "color-mix(in srgb, var(--head-color) 70%, var(--color-neutral-100))",
                backgroundColor: "color-mix(in srgb, var(--head-color) 22%, transparent)",
              }}
            >
              <GitBranch size={15} className="shrink-0" />
              <span className="truncate">{status?.currentBranch ?? repo.currentBranch ?? "(detached)"}</span>
            </span>
            {status && (status.ahead > 0 || status.behind > 0) && (
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-neutral-400" title="ahead / behind upstream">
                <span className="inline-flex items-center">
                  <ArrowUp size={12} />
                  {status.ahead}
                </span>
                <span className="inline-flex items-center">
                  <ArrowDown size={12} />
                  {status.behind}
                </span>
              </span>
            )}
            {status?.inProgressOp && (
              <span className="flex shrink-0 items-center gap-1.5 rounded bg-amber-900/60 py-0.5 pr-0.5 pl-1.5 text-xs text-amber-200">
                {IN_PROGRESS_LABELS[status.inProgressOp]} in progress
                <button
                  onClick={abortInProgress}
                  title={`Abort the ${IN_PROGRESS_LABELS[status.inProgressOp].toLowerCase()} and go back to how things were before it`}
                  className="flex items-center gap-1 rounded bg-red-900 px-1.5 py-px text-red-100 hover:bg-red-800"
                >
                  <CircleX size={11} /> Abort
                </button>
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-neutral-500" title={repo.path}>
            {repo.path}
          </p>
        </div>
        {hasDetailsPanel && (
          <button
            onClick={() => setDetailsOpen(!detailsOpen)}
            title={detailsOpen ? "Hide details panel" : "Show details panel"}
            className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          >
            {detailsOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
        )}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 gap-2 overflow-hidden px-4 pb-4">
        {branchesOpen && (
          <ResizableSidebar
            side="left"
            configKey="sidebar.branchesWidth"
            defaultWidth={240}
            minWidth={160}
            maxWidth={480}
          >
            <BranchSidebar
              repoId={repo.repoId}
              currentBranch={status?.currentBranch ?? null}
              selectedStashSha={selected?.kind === "stash" ? selected.stash.sha : null}
              onSelectStash={(stash) => {
                setSelected({ kind: "stash", stash });
                setOpenFile(null);
                setDetailsOpen(true);
              }}
            />
          </ResizableSidebar>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded border border-neutral-800">
          <div className="min-h-0 flex-1 overflow-hidden">
            {openConflictPath && showRebaseConflicts ? (
              (() => {
                const conflict = rebaseStatus!.conflicts.find((c) => c.path === openConflictPath);
                return conflict ? (
                  <ConflictResolutionView
                    key={conflict.path}
                    repoId={repo.repoId}
                    file={conflict}
                    onResolved={() => setOpenConflictPath(null)}
                    onClose={() => setOpenConflictPath(null)}
                  />
                ) : null;
              })()
            ) : openFile ? (
              <FileDiffFullView
                repoId={repo.repoId}
                sha={openFileSha}
                file={openFile}
                workingSide={openFileSha === null && showStaging ? openFileSide : null}
                onBack={() => setOpenFile(null)}
                actions={
                  <>
                    <button
                      onClick={() => openFileHistory(repo.repoId, openFile.path, openFileSha)}
                      className="rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700"
                    >
                      History
                    </button>
                    {openFile.status !== "Deleted" && (
                      <button
                        onClick={() => openBlame(repo.repoId, openFile.path, openFileSha)}
                        title={openFileSha ? "Blame at this commit" : "Blame at HEAD"}
                        className="rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700"
                      >
                        Blame
                      </button>
                    )}
                  </>
                }
              />
            ) : (
              <CommitGraph
                repoId={repo.repoId}
                selection={selected}
                currentBranch={status?.currentBranch ?? null}
                hasLocalChanges={hasLocalChanges}
                onSelectionChange={(next) => {
                  setSelected(next);
                  setDetailsOpen(true);
                  setOpenFile(null);
                }}
              />
            )}
          </div>
          {!terminalOpen && (
            <button
              onClick={toggleTerminal}
              className="flex shrink-0 items-center gap-2 border-t border-neutral-800 bg-neutral-950 px-3 py-1 text-left text-xs text-neutral-300 hover:bg-neutral-900"
            >
              <ChevronUp size={14} />
              <span className="uppercase">Terminal</span>
              <span className="text-neutral-500/70">Ctrl + '</span>
            </button>
          )}
          {terminalEverOpened && (
            <div className={terminalOpen ? "contents" : "hidden"}>
              <TerminalPanel
                repoId={repo.repoId}
                cwd={repo.path}
                onClose={() => setTerminalOpen(false)}
                onKill={() => {
                  setTerminalOpen(false);
                  setTerminalEverOpened(false);
                }}
              />
            </div>
          )}
        </div>
        {!detailsOpen ? null : showRebaseConflicts ? (
          <ResizableSidebar configKey="sidebar.detailsWidth">
            <RebaseConflictPanel
              repoId={repo.repoId}
              onOpenConflict={setOpenConflictPath}
              openConflictPath={openConflictPath}
            />
          </ResizableSidebar>
        ) : (showStaging || showCommitDetails || showMultiCommitDetails || showStashDetails) && (
          <ResizableSidebar configKey="sidebar.detailsWidth">
            {selected?.kind === "commit" ? (
              <CommitDetailsPanel
                repoId={repo.repoId}
                commit={selected.commit}
                selectedFilePath={openFile?.path ?? null}
                onOpenFile={setOpenFile}
                onAmended={(updated) => setSelected({ kind: "commit", commit: updated })}
              />
            ) : selected?.kind === "commits" ? (
              <MultiCommitDetailsPanel
                repoId={repo.repoId}
                commits={selected.commits}
                fromSha={selected.fromSha}
                toSha={selected.toSha}
                selectedFilePath={openFile?.path ?? null}
                onOpenFile={setOpenFile}
              />
            ) : selected?.kind === "stash" ? (
              <StashDetailsPanel
                repoId={repo.repoId}
                stash={selected.stash}
                selectedFilePath={openFile?.path ?? null}
                onOpenFile={setOpenFile}
              />
            ) : (
              <StagingPanel
                repoId={repo.repoId}
                repoPath={repo.path}
                selectedFilePath={openFile?.path ?? null}
                selectedSide={openFileSide}
                onOpenFile={(file, side) => {
                  setOpenFile(file);
                  setOpenFileSide(side ?? null);
                }}
                headCommit={headCommit ?? null}
              />
            )}
          </ResizableSidebar>
        )}
      </div>
    </main>
  );
}
