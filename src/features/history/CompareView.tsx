import { useQuery } from "@tanstack/react-query";
import { Layers, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { CommitNode } from "@/features/commit-graph/types";
import { getCommitDiff } from "@/features/diff-viewer/api";
import { ChangedFileList } from "@/features/diff-viewer/ChangedFileList";
import { lazyNamed } from "@/lib/lazy";

const FileDiffFullView = lazyNamed(() => import("@/features/diff-viewer/FileDiffFullView"), "FileDiffFullView");
import type { FileDiff } from "@/features/diff-viewer/types";
import { queryKeys } from "@/lib/query-keys";
import { errorMessage } from "@/lib/tauri-client";
import { getBranchCompare, getTreeDiff } from "./api";
import { CommitRow } from "./CommitRow";
import { compareRange, type CompareSide } from "./model";
import { fileHistoryMenuItems } from "./store";

/** Commits listed per side; the counts are exact either way. */
const LIST_LIMIT = 500;

/** Two branches side by side: the commits each has that the other doesn't
 * (since their merge base) and, per side, the aggregate diff of those
 * commits (`git diff other...side`) or of one picked commit. */
export function CompareView({
  repoId,
  a,
  b,
  onSelectCommit,
}: {
  repoId: string;
  a: string;
  b: string;
  onSelectCommit: (commit: CommitNode) => void;
}) {
  const cmp = useQuery({
    queryKey: queryKeys.branchCompare(repoId, a, b),
    queryFn: () => getBranchCompare(repoId, a, b, LIST_LIMIT),
    // Branch tips move; a short staleTime keeps reopening cheap without lying for long.
    staleTime: 10_000,
  });
  const [side, setSide] = useState<CompareSide>("a");
  const [commitSha, setCommitSha] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<FileDiff | null>(null);

  // Start on the side that actually has something.
  useEffect(() => {
    if (cmp.data && cmp.data.onlyInATotal === 0 && cmp.data.onlyInBTotal > 0) setSide("b");
  }, [cmp.data]);

  const range = cmp.data ? compareRange(cmp.data, side) : null;
  const aggregate = useQuery({
    queryKey: queryKeys.treeDiff(repoId, range?.from ?? "", range?.to ?? ""),
    queryFn: () => getTreeDiff(repoId, range!.from, range!.to),
    enabled: !!range && commitSha === null,
    staleTime: Infinity,
  });
  const single = useQuery({
    queryKey: queryKeys.commitDiff(repoId, commitSha ?? ""),
    queryFn: () => getCommitDiff(repoId, commitSha!),
    enabled: commitSha !== null,
  });
  const shown = commitSha ? single : aggregate;
  const shownSha = commitSha ?? range?.to ?? null;

  const pick = (nextSide: CompareSide, sha: string | null) => {
    setSide(nextSide);
    setCommitSha(sha);
    setOpenFile(null);
  };

  if (cmp.isPending) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-neutral-500">
        <Loader2 size={14} className="animate-spin" /> Comparing...
      </div>
    );
  }
  if (cmp.error) return <p className="p-4 text-sm text-red-400">{errorMessage(cmp.error)}</p>;
  const data = cmp.data!;
  const commits = side === "a" ? data.onlyInA : data.onlyInB;
  const total = side === "a" ? data.onlyInATotal : data.onlyInBTotal;
  const [name, other] = side === "a" ? [a, b] : [b, a];

  const tab = (s: CompareSide, label: string, count: number) => (
    <button
      onClick={() => pick(s, null)}
      className={`min-w-0 flex-1 truncate px-2 py-1.5 text-xs ${
        side === s ? "border-b-2 border-blue-500 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"
      }`}
      title={label}
    >
      {label} ({count})
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex w-[380px] shrink-0 flex-col overflow-hidden border-r border-neutral-800">
        <div className="flex shrink-0 border-b border-neutral-800">
          {tab("a", `Only in ${a}`, data.onlyInATotal)}
          {tab("b", `Only in ${b}`, data.onlyInBTotal)}
        </div>
        <p className="shrink-0 px-3 py-1 text-[11px] text-neutral-500">
          {data.mergeBase ? `merge base ${data.mergeBase.slice(0, 7)}` : "no common ancestor"}
        </p>
        <div className="min-h-0 flex-1 overflow-auto">
          {total === 0 ? (
            <p className="p-3 text-sm text-neutral-500">
              {name} has no commits that {other} doesn't have.
            </p>
          ) : (
            <ul>
              <li
                onClick={() => pick(side, null)}
                className={`flex cursor-pointer items-center gap-2 border-b border-neutral-800/60 px-3 py-2 text-sm ${
                  commitSha === null ? "bg-neutral-800" : "hover:bg-neutral-900"
                }`}
              >
                <Layers size={14} className="shrink-0 text-neutral-400" />
                All changes in {name} since it diverged
              </li>
              {commits.map((c) => (
                <CommitRow
                  key={c.sha}
                  commit={c}
                  selected={commitSha === c.sha}
                  onClick={() => pick(side, c.sha)}
                  onDoubleClick={() => onSelectCommit(c)}
                />
              ))}
            </ul>
          )}
          {commits.length < total && (
            <p className="px-3 py-2 text-xs text-neutral-500">
              Showing the newest {commits.length} of {total} commits.
            </p>
          )}
        </div>
      </div>

      {total > 0 && (
        <div className="flex w-[320px] shrink-0 flex-col overflow-hidden border-r border-neutral-800 text-sm">
          {shown.error ? (
            <p className="p-3 text-sm text-red-400">{errorMessage(shown.error)}</p>
          ) : (
            <ChangedFileList
              title={`${shown.data?.files.length ?? 0} file(s) changed`}
              files={shown.data?.files ?? []}
              isPending={shown.isPending}
              selectedFilePath={openFile?.path ?? null}
              onOpenFile={setOpenFile}
              fileMenu={(file) => fileHistoryMenuItems(repoId, file.path, shownSha)}
            />
          )}
        </div>
      )}

      <div className="min-w-0 flex-1 overflow-hidden">
        {openFile ? (
          <FileDiffFullView repoId={repoId} sha={shownSha} file={openFile} onBack={() => setOpenFile(null)} />
        ) : (
          total > 0 && <p className="p-4 text-sm text-neutral-500">Select a file to see its changes.</p>
        )}
      </div>
    </div>
  );
}
