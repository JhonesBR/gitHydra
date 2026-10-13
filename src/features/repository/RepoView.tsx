import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
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
import { CommitTreeView } from "@/features/commit-tree/CommitTreeView";
import { StatisticsView } from "@/features/statistics/StatisticsView";
import { getHeadCommit } from "@/features/commit-graph/api";
import { CommitGraph } from "@/features/commit-graph/CommitGraph";
import type { GraphSelection } from "@/features/commit-graph/types";
import { CommitDetailsPanel } from "@/features/diff-viewer/CommitDetailsPanel";
import { FileDiffFullView } from "@/features/diff-viewer/FileDiffFullView";
import { MultiCommitDetailsPanel } from "@/features/diff-viewer/MultiCommitDetailsPanel";
import type { FileDiff } from "@/features/diff-viewer/types";
import { getRebaseStatus } from "@/features/rebase/api";
import { ConflictResolutionView } from "@/features/rebase/ConflictResolutionView";
import { RebaseConflictPanel } from "@/features/rebase/RebaseConflictPanel";
import { useRebaseStore } from "@/features/rebase/store";
import { fetchRemote } from "@/features/remote-ops/api";
import { StashDetailsPanel } from "@/features/stash/StashDetailsPanel";
import { TerminalPanel } from "@/features/terminal/TerminalPanel";
import { StagingPanel } from "@/features/working/StagingPanel";
import { queryKeys } from "@/lib/query-keys";
import { usePersistedValue } from "@/lib/use-persisted-config";
import type { RepoSummary } from "./api";
import { getRepoStatus } from "./api";
import { useTabsStore } from "./store";
import { TopBar } from "./TopBar";
import { useRepoPolling } from "./useRepoPolling";

export function RepoView({ tabId, repo }: { tabId: string; repo: RepoSummary }) {
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const rebaseStatus = useRebaseStore((s) => s.status);
  const setRebaseStatus = useRebaseStore((s) => s.setStatus);
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<GraphSelection>(null);
  const [openFile, setOpenFile] = useState<FileDiff | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [branchesOpen, setBranchesOpen] = usePersistedValue("sidebar.branchesOpen", true);
  // Right-hand details panel can be tucked away (e.g. to read a diff at full
  // width); picking something new in the graph brings it back.
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [treeOpen, setTreeOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
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
    // Best-effort: a repo with no remote (or no network) shouldn't block
    // opening it, so failures here are silent. Still dismiss the "fetch"
    // progress toast either way — RemoteOpsButtons' progress-event listener
    // populates it for ANY fetch, including this silent one, and it would
    // otherwise sit there forever since nothing else resolves it.
    fetchRemote(repo.repoId, "origin")
      .then(() => {
        toast.dismiss("fetch");
        queryClient.invalidateQueries({ queryKey: queryKeys.branches(repo.repoId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.commitLog(repo.repoId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.headCommit(repo.repoId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.repoStatus(repo.repoId) });
      })
      .catch(() => {
        toast.dismiss("fetch");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.repoId]);

  useRepoPolling(repo.repoId);

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

  const toggleTerminal = () => {
    setTerminalEverOpened(true);
    setTerminalOpen((o) => !o);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (tabId !== activeTabId) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "'") {
        e.preventDefault();
        toggleTerminal();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, activeTabId]);

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
        branch={status?.currentBranch ?? null}
        hasLocalChanges={hasLocalChanges}
        terminalOpen={terminalOpen}
        onToggleTerminal={toggleTerminal}
        onOpenTree={() => setTreeOpen(true)}
        onOpenStats={() => setStatsOpen(true)}
      />
      {statsOpen && <StatisticsView repoId={repo.repoId} onClose={() => setStatsOpen(false)} />}
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
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-neutral-400" title="ahead / behind origin">
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
              <span className="shrink-0 rounded bg-amber-900/60 px-1.5 py-0.5 text-xs text-amber-200">
                {status.inProgressOp} in progress
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
                onBack={() => setOpenFile(null)}
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
          {terminalEverOpened && (
            <div className={terminalOpen ? "contents" : "hidden"}>
              <TerminalPanel
                repoId={repo.repoId}
                cwd={repo.path}
                onClose={() => setTerminalOpen(false)}
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
                selectedFilePath={openFile?.path ?? null}
                onOpenFile={setOpenFile}
                headCommit={headCommit ?? null}
              />
            )}
          </ResizableSidebar>
        )}
      </div>
    </main>
  );
}
