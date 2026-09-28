import { useQuery } from "@tanstack/react-query";
import { getCommitDiff } from "@/features/diff-viewer/api";
import { statusLabel } from "@/features/diff-viewer/CommitDetailsPanel";
import type { FileDiff } from "@/features/diff-viewer/types";
import { queryKeys } from "@/lib/query-keys";
import type { StashInfo } from "./types";

export function StashDetailsPanel({
  repoId,
  stash,
  selectedFilePath,
  onOpenFile,
}: {
  repoId: string;
  stash: StashInfo;
  selectedFilePath: string | null;
  onOpenFile: (file: FileDiff) => void;
}) {
  const { data, isPending } = useQuery({
    queryKey: queryKeys.commitDiff(repoId, stash.sha),
    queryFn: () => getCommitDiff(repoId, stash.sha),
  });

  return (
    <div className="flex h-full flex-col overflow-hidden text-sm">
      <div className="shrink-0 border-b border-neutral-800 p-3">
        <p className="mb-2 font-mono text-xs text-neutral-500">stash: {stash.sha.slice(0, 7)}</p>
        <p className="whitespace-pre-wrap font-medium text-neutral-100">{stash.message}</p>
      </div>

      <div className="flex-1 overflow-auto">
        <p className="sticky top-0 bg-neutral-950 px-3 py-1.5 text-xs uppercase text-neutral-500">
          {data?.files.length ?? 0} file(s) changed
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
