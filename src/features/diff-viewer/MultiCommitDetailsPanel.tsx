import { useQuery } from "@tanstack/react-query";
import type { CommitNode } from "@/features/commit-graph/types";
import { queryKeys } from "@/lib/query-keys";
import { getRangeDiff } from "./api";
import { statusLabel } from "./CommitDetailsPanel";
import type { FileDiff } from "./types";

export function MultiCommitDetailsPanel({
  repoId,
  commits,
  fromSha,
  toSha,
  selectedFilePath,
  onOpenFile,
}: {
  repoId: string;
  commits: CommitNode[];
  fromSha: string;
  toSha: string;
  selectedFilePath: string | null;
  onOpenFile: (file: FileDiff) => void;
}) {
  const { data, isPending } = useQuery({
    queryKey: queryKeys.rangeDiff(repoId, fromSha, toSha),
    queryFn: () => getRangeDiff(repoId, fromSha, toSha),
  });

  return (
    <div className="flex h-full flex-col overflow-hidden text-sm">
      <div className="max-h-48 shrink-0 overflow-auto border-b border-neutral-800 p-3">
        <p className="mb-2 text-xs uppercase text-neutral-500">{commits.length} commits selected</p>
        <ul className="space-y-1">
          {commits.map((commit) => (
            <li key={commit.sha} className="truncate text-xs text-neutral-300">
              <span className="mr-2 font-mono text-neutral-500">{commit.shortSha}</span>
              {commit.summary}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex-1 overflow-auto">
        <p className="sticky top-0 bg-neutral-950 px-3 py-1.5 text-xs uppercase text-neutral-500">
          {data?.files.length ?? 0} file(s) changed in range
        </p>
        {isPending && <p className="px-3 py-1 text-neutral-500">Loading...</p>}
        <ul>
          {data?.files.map((file) => (
            <li
              key={file.path}
              onClick={() => onOpenFile(file)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-1 ${
                selectedFilePath === file.path ? "bg-neutral-800" : "hover:bg-neutral-900"
              }`}
            >
              <span className="w-4 shrink-0 text-center font-mono text-xs text-neutral-500">
                {statusLabel(file.status)}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-neutral-300">{file.path}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
