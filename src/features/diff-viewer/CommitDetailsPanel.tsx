import { useQuery } from "@tanstack/react-query";
import type { CommitNode } from "@/features/commit-graph/types";
import { gravatarUrl } from "@/lib/gravatar";
import { queryKeys } from "@/lib/query-keys";
import { getCommitDiff } from "./api";
import type { FileDiff } from "./types";

export function statusLabel(status: FileDiff["status"]): string {
  switch (status) {
    case "Added":
      return "A";
    case "Deleted":
      return "D";
    case "Renamed":
      return "R";
    case "Copied":
      return "C";
    case "TypeChange":
      return "T";
    case "Modified":
      return "M";
    default:
      return "?";
  }
}

export function CommitDetailsPanel({
  repoId,
  commit,
  selectedFilePath,
  onOpenFile,
}: {
  repoId: string;
  commit: CommitNode | null;
  selectedFilePath: string | null;
  onOpenFile: (file: FileDiff) => void;
}) {
  const { data, isPending } = useQuery({
    queryKey: queryKeys.commitDiff(repoId, commit?.sha ?? ""),
    queryFn: () => getCommitDiff(repoId, commit!.sha),
    enabled: !!commit,
  });

  if (!commit) {
    return <p className="p-4 text-sm text-neutral-500">Select a commit.</p>;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden text-sm">
      <div className="shrink-0 border-b border-neutral-800 p-3">
        <p className="mb-2 font-mono text-xs text-neutral-500">commit: {commit.shortSha}</p>
        <p className="mb-1 whitespace-pre-wrap font-medium text-neutral-100">{commit.summary}</p>
        {commit.body && (
          <p className="mb-3 whitespace-pre-wrap text-xs text-neutral-400">{commit.body}</p>
        )}

        <div className="flex items-center gap-2">
          <img
            src={gravatarUrl(commit.authorEmail, 32)}
            alt={commit.authorName}
            className="h-8 w-8 shrink-0 rounded-full"
          />
          <div className="min-w-0">
            <p className="truncate text-neutral-200">{commit.authorName}</p>
            <p className="truncate text-xs text-neutral-500">{commit.authorEmail}</p>
            <p className="text-xs text-neutral-500">
              authored {new Date(commit.authorDate * 1000).toLocaleString()}
            </p>
          </div>
        </div>
        {commit.committerDate !== commit.authorDate && (
          <p className="mt-1 pl-10 text-xs text-neutral-500">
            committed {new Date(commit.committerDate * 1000).toLocaleString()}
          </p>
        )}
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
