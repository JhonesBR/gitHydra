import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { useTabsStore } from "@/features/repository/store";
import { queryKeys } from "@/lib/query-keys";
import { errorMessage } from "@/lib/tauri-client";
import { listSubmodules, submodulesKey, updateSubmodules, type SubmoduleState } from "./api";
import { STATE_LABELS, canOpen, needsUpdate } from "./state";

const STATE_TONE: Record<SubmoduleState, string> = {
  uninitialized: "bg-neutral-800 text-neutral-300",
  outOfDate: "bg-amber-950 text-amber-300",
  dirty: "bg-sky-950 text-sky-300",
  upToDate: "bg-emerald-950 text-emerald-300",
};

export function SubmodulesModal({ repoId, onClose }: { repoId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const openPathInNewTab = useTabsStore((s) => s.openPathInNewTab);
  const { data: submodules, error, isPending } = useQuery({
    queryKey: submodulesKey(repoId),
    queryFn: () => listSubmodules(repoId),
    // Status reads each submodule's checkout: refresh on open, not on every poll.
    refetchOnMount: "always",
  });

  const update = useMutation({
    mutationFn: (paths: string[]) => updateSubmodules(repoId, paths),
    onSuccess: (list, paths) => {
      queryClient.setQueryData(submodulesKey(repoId), list);
      queryClient.invalidateQueries({ queryKey: queryKeys.workingStatus(repoId) });
      toast.success(paths.length === 1 ? `Updated ${paths[0]}` : `Updated ${paths.length} submodules`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const pending = needsUpdate(submodules ?? []);

  return (
    <Modal onClose={onClose} align="top" width="w-[680px]">
      <div className="flex max-h-[75vh] flex-col text-sm">
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-800 px-3 py-2">
          <span className="font-semibold text-neutral-200">Submodules</span>
          {pending.length > 0 && (
            <button
              onClick={() => update.mutate(pending.map((s) => s.path))}
              disabled={update.isPending}
              title="git submodule update --init for those not checked out or on another commit"
              className="flex items-center gap-1 rounded bg-emerald-800 px-2 py-1 text-xs text-emerald-50 hover:bg-emerald-700 disabled:opacity-50"
            >
              {update.isPending && <Loader2 size={11} className="animate-spin" />} Init & update ({pending.length})
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isPending ? (
            <div className="flex items-center gap-2 p-4 text-neutral-400">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : error ? (
            <p className="p-4 text-red-400">{errorMessage(error)}</p>
          ) : submodules?.length === 0 ? (
            <p className="p-4 text-neutral-500">This repository has no submodules.</p>
          ) : (
            <ul>
              {submodules?.map((sm) => (
                <li key={sm.path} className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-mono text-xs text-neutral-100">{sm.path}</span>
                      <span className={`shrink-0 rounded px-1.5 py-px text-[10px] ${STATE_TONE[sm.state]}`}>
                        {STATE_LABELS[sm.state]}
                      </span>
                    </div>
                    <p className="truncate text-xs text-neutral-500" title={sm.url ?? undefined}>
                      {sm.expectedSha?.slice(0, 7) ?? "—"}
                      {sm.currentSha && sm.currentSha !== sm.expectedSha && ` (checked out ${sm.currentSha.slice(0, 7)})`}
                      {sm.url && ` · ${sm.url}`}
                    </p>
                  </div>
                  {sm.state !== "upToDate" && (
                    <button
                      onClick={() => update.mutate([sm.path])}
                      disabled={update.isPending}
                      title={`git submodule update --init ${sm.path}`}
                      className="shrink-0 rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700 disabled:opacity-50"
                    >
                      {sm.initialized ? "Update" : "Init & update"}
                    </button>
                  )}
                  {canOpen(sm) && (
                    <button
                      onClick={() => {
                        openPathInNewTab(sm.absPath);
                        onClose();
                      }}
                      className="shrink-0 rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700"
                    >
                      Open in tab
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex shrink-0 justify-end border-t border-neutral-800 p-2">
          <button
            onClick={onClose}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
