import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Download, Loader2, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/lib/confirm-store";
import { errorMessage } from "@/lib/tauri-client";
import { fetchRepoAtPath, scanWorkspace } from "./api";
import type { WorkspaceEntry } from "./types";
import { WorkspaceEditModal } from "./WorkspaceEditModal";

export function WorkspaceEntryRow({
  workspace,
  filter,
  onOpenRepo,
  onRename,
  onSetIgnoredPaths,
  onRemove,
}: {
  workspace: WorkspaceEntry;
  filter: string;
  onOpenRepo: (path: string) => void;
  onRename: (name: string) => void;
  onSetIgnoredPaths: (paths: string[]) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ["workspaceScan", workspace.id] as const;

  const { data: repos, isPending, isFetching } = useQuery({
    queryKey,
    queryFn: () => scanWorkspace(workspace.path),
  });

  const visibleRepos = (repos ?? []).filter((r) => !workspace.ignoredPaths.includes(r.path));
  const needle = filter.trim().toLowerCase();
  const workspaceMatches = !needle || workspace.name.toLowerCase().includes(needle);
  const shownRepos = workspaceMatches
    ? visibleRepos
    : visibleRepos.filter((r) => r.name.toLowerCase().includes(needle));

  const handleDelete = async () => {
    const confirmed = await confirm(
      `Remove workspace "${workspace.name}" from the list? The repositories will not be deleted from disk.`,
      { title: "Remove workspace", kind: "warning" },
    );
    if (confirmed) onRemove();
  };

  const fetchAllMutation = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        visibleRepos.map((r) => fetchRepoAtPath(r.path)),
      );
      const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      return { total: results.length, failed };
    },
  });

  const handleFetchAll = () => {
    toast.promise(fetchAllMutation.mutateAsync(), {
      id: `fetch-all-${workspace.id}`,
      loading: `Fetching ${visibleRepos.length} repositories...`,
      success: ({ total, failed }) =>
        failed.length === 0
          ? `Fetched ${total} repositories`
          : `Fetched ${total - failed.length}/${total} repositories (${failed.length} failed: ${failed
              .map((f) => errorMessage(f.reason))
              .join(", ")})`,
      error: (e) => errorMessage(e),
    });
  };

  // While filtering, hide workspaces with nothing to show once their scan is in.
  if (needle && !isPending && shownRepos.length === 0) return null;

  return (
    <div className="rounded border border-neutral-800">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex shrink-0 items-center text-neutral-400 hover:text-neutral-200"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-neutral-200">{workspace.name}</p>
          <p className="truncate text-xs text-neutral-500">{workspace.path}</p>
        </div>

        <button
          onClick={handleFetchAll}
          disabled={fetchAllMutation.isPending || visibleRepos.length === 0}
          title="Fetch all"
          className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-40"
        >
          {fetchAllMutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Download size={14} />
          )}
        </button>
        <button
          onClick={() => setEditing(true)}
          title="Edit workspace"
          className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey })}
          title="Refresh"
          className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
        >
          {isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
        <button
          onClick={handleDelete}
          title="Remove workspace"
          className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-red-400"
        >
          <Trash2 size={14} />
        </button>
      </div>
      {(open || needle) && (
        <ul className="max-h-96 overflow-auto border-t border-neutral-800">
          {isPending && <li className="px-3 py-2 text-xs text-neutral-500">Fetching repositories...</li>}
          {shownRepos.map((r) => (
            <li
              key={r.path}
              onClick={() => onOpenRepo(r.path)}
              className="cursor-pointer px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
            >
              {r.name}
            </li>
          ))}
          {visibleRepos.length === 0 && (
            <li className="px-3 py-2 text-xs text-neutral-500">No repositories found</li>
          )}
        </ul>
      )}
      {editing && (
        <WorkspaceEditModal
          workspace={workspace}
          repos={repos ?? []}
          onClose={() => setEditing(false)}
          onRename={onRename}
          onSetIgnoredPaths={onSetIgnoredPaths}
        />
      )}
    </div>
  );
}
