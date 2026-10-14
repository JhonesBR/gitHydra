import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { CommitNode } from "@/features/commit-graph/types";
import { FileDiffFullView } from "@/features/diff-viewer/FileDiffFullView";
import { queryKeys } from "@/lib/query-keys";
import { errorMessage } from "@/lib/tauri-client";
import { getCommitFileDiff, getFileHistory } from "./api";
import { CommitRow } from "./CommitRow";
import { openBlame, useHistoryViewStore } from "./store";
import type { FileHistoryCursor } from "./types";

const PAGE_SIZE = 300;

const headerButton = "rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700";

/** Commits that touched `path` (following renames), newest first, with the
 * selected commit's diff of that one file. Loads 300 commits at a time. */
export function FileHistoryView({
  repoId,
  path,
  startSha,
  onSelectCommit,
}: {
  repoId: string;
  path: string;
  /** Resolved commit the walk starts from (HEAD already resolved). */
  startSha: string;
  onSelectCommit: (commit: CommitNode) => void;
}) {
  const back = useHistoryViewStore((s) => s.back);
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending, error } = useInfiniteQuery({
    queryKey: queryKeys.fileHistory(repoId, path, startSha),
    queryFn: ({ pageParam }) => getFileHistory(repoId, path, startSha, pageParam, PAGE_SIZE),
    initialPageParam: null as FileHistoryCursor | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: Infinity,
  });
  const entries = useMemo(() => data?.pages.flatMap((p) => p.entries) ?? [], [data]);
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const selected = entries.find((e) => e.commit.sha === selectedSha) ?? entries[0] ?? null;

  const diff = useQuery({
    queryKey: queryKeys.commitFileDiff(repoId, selected?.commit.sha ?? "", selected?.path ?? "", selected?.oldPath ?? null),
    queryFn: () => getCommitFileDiff(repoId, selected!.commit.sha, selected!.path, selected!.oldPath),
    enabled: !!selected,
    staleTime: Infinity,
  });

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex w-[420px] shrink-0 flex-col overflow-hidden border-r border-neutral-800">
        <div className="min-h-0 flex-1 overflow-auto">
          {isPending && (
            <div className="flex items-center gap-2 p-4 text-sm text-neutral-500">
              <Loader2 size={14} className="animate-spin" /> Walking history...
            </div>
          )}
          {error && <p className="p-4 text-sm text-red-400">{errorMessage(error)}</p>}
          <ul>
            {entries.map((entry) => (
              <CommitRow
                key={entry.commit.sha}
                commit={entry.commit}
                selected={entry === selected}
                onClick={() => setSelectedSha(entry.commit.sha)}
                onDoubleClick={() => onSelectCommit(entry.commit)}
                badge={
                  entry.status === "Renamed" ? (
                    <span
                      title={`${entry.oldPath} → ${entry.path}`}
                      className="shrink-0 rounded bg-violet-900/60 px-1 text-[10px] text-violet-200"
                    >
                      renamed
                    </span>
                  ) : entry.status === "Added" ? (
                    <span className="shrink-0 rounded bg-emerald-900/60 px-1 text-[10px] text-emerald-200">added</span>
                  ) : null
                }
              />
            ))}
          </ul>
          {data && entries.length === 0 && !hasNextPage && (
            <p className="p-4 text-sm text-neutral-500">No commits touch this file.</p>
          )}
          {hasNextPage && (
            <button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="flex w-full items-center justify-center gap-2 py-2 text-xs text-neutral-400 hover:bg-neutral-900 disabled:opacity-60"
            >
              {isFetchingNextPage && <Loader2 size={12} className="animate-spin" />}
              Load more
            </button>
          )}
        </div>
        <p className="shrink-0 border-t border-neutral-800 px-3 py-1 text-[11px] text-neutral-500">
          {entries.length} commit(s){hasNextPage ? " so far" : ""} · double-click to select in the graph
        </p>
      </div>

      <div className="min-w-0 flex-1 overflow-hidden">
        {!selected ? null : diff.isPending ? (
          <div className="flex items-center gap-2 p-4 text-sm text-neutral-500">
            <Loader2 size={14} className="animate-spin" /> Loading diff...
          </div>
        ) : diff.error ? (
          <p className="p-4 text-sm text-red-400">{errorMessage(diff.error)}</p>
        ) : diff.data ? (
          <FileDiffFullView
            key={selected.commit.sha}
            repoId={repoId}
            sha={selected.commit.sha}
            file={diff.data}
            onBack={back}
            actions={
              <>
                <button className={headerButton} onClick={() => openBlame(repoId, selected.path, selected.commit.sha)}>
                  Blame here
                </button>
                <button className={headerButton} onClick={() => onSelectCommit(selected.commit)}>
                  Show in graph
                </button>
              </>
            }
          />
        ) : (
          <p className="p-4 text-sm text-neutral-500">This commit doesn't change the file against its first parent.</p>
        )}
      </div>
    </div>
  );
}
