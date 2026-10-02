import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ResizableSidebar } from "@/components/ResizableSidebar";
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
import { closeRepository, getRepoStatus } from "./api";
import { useRepoStore } from "./store";
import { TopBar } from "./TopBar";
import { useRepoPolling } from "./useRepoPolling";

export function RepoView() {
  const repo = useRepoStore((s) => s.repo);
  const setRepo = useRepoStore((s) => s.setRepo);
  const rebaseStatus = useRebaseStore((s) => s.status);
  const setRebaseStatus = useRebaseStore((s) => s.setStatus);
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<GraphSelection>(null);
  const [openFile, setOpenFile] = useState<FileDiff | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [openConflictPath, setOpenConflictPath] = useState<string | null>(null);
  const showRebaseConflicts = rebaseStatus?.state === "Conflicts";

  useEffect(() => {
    if (!showRebaseConflicts) setOpenConflictPath(null);
  }, [showRebaseConflicts]);

  const { data: status } = useQuery({
    queryKey: queryKeys.repoStatus(repo?.repoId ?? ""),
    queryFn: () => getRepoStatus(repo!.repoId),
    enabled: !!repo,
  });

  useEffect(() => {
    if (!repo) return;
    // Sync with the backend's real rebase state instead of trusting only past
    // mutation results — covers a lost/stale in-memory session on either side.
    getRebaseStatus(repo.repoId).then(setRebaseStatus);
  }, [repo, setRebaseStatus]);

  useEffect(() => {
    if (!repo) return;
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
        queryClient.invalidateQueries({ queryKey: queryKeys.repoStatus(repo.repoId) });
      })
      .catch(() => {
        toast.dismiss("fetch");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.repoId]);

  useRepoPolling(repo?.repoId ?? "");

  // Auto-select local changes on open, once per repo — but never fight a
  // deliberate deselect, so this only fires the first time status loads.
  const autoSelectedRepoId = useRef<string | null>(null);
  useEffect(() => {
    if (!repo || status === undefined) return;
    if (autoSelectedRepoId.current === repo.repoId) return;
    autoSelectedRepoId.current = repo.repoId;
    const hasChanges = (status.dirtyFiles + status.stagedFiles) > 0;
    if (hasChanges) setSelected({ kind: "wip" });
  }, [repo, status]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "'") {
        e.preventDefault();
        setTerminalOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!repo) return null;

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

  return (
    <main className="flex h-screen w-screen flex-col overflow-hidden bg-neutral-950 text-neutral-100">
      <TopBar repoId={repo.repoId} branch={status?.currentBranch ?? null} />

      <div className="flex items-center justify-between px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">{repo.path}</h1>
          <p className="text-xs text-neutral-400">
            branch: {status?.currentBranch ?? repo.currentBranch ?? "(detached)"}
            {status && ` — ahead/behind: ${status.ahead}/${status.behind}`}
            {status?.inProgressOp && ` — operation in progress: ${status.inProgressOp}`}
          </p>
        </div>
        <button
          onClick={() => {
            closeRepository(repo.repoId);
            setRepo(null);
          }}
          className="rounded bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700"
        >
          Close
        </button>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 gap-2 overflow-hidden px-4 pb-4">
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
                  setOpenFile(null);
                }}
              />
            )}
          </div>
          {terminalOpen && (
            <TerminalPanel repoId={repo.repoId} cwd={repo.path} onClose={() => setTerminalOpen(false)} />
          )}
        </div>
        {showRebaseConflicts ? (
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
              />
            )}
          </ResizableSidebar>
        )}
      </div>
    </main>
  );
}
