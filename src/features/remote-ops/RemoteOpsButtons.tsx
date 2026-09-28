import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { getRepoStatus } from "@/features/repository/api";
import { confirm } from "@/lib/confirm-store";
import { queryKeys } from "@/lib/query-keys";
import type { GitCommandError } from "@/lib/tauri-client";
import { errorMessage } from "@/lib/tauri-client";
import { useTauriEvent } from "@/lib/tauri-events";
import { fetchRemote, pushBranch } from "./api";
import type { FetchProgressEvent, PushProgressEvent } from "./types";

export function RemoteOpsButtons({ repoId, branch }: { repoId: string; branch: string | null }) {
  const queryClient = useQueryClient();
  const anyMutating = useIsMutating() > 0;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.branches(repoId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.commitLog(repoId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.repoStatus(repoId) });
  };

  useTauriEvent<FetchProgressEvent>("git://fetch-progress", (p) => {
    if (p.repoId !== repoId) return;
    toast.loading(`Fetch: ${p.receivedObjects}/${p.totalObjects} objects`, { id: "fetch" });
  });
  useTauriEvent<PushProgressEvent>("git://push-progress", (p) => {
    if (p.repoId !== repoId) return;
    toast.loading(`Push: ${p.current}/${p.total}`, { id: "push" });
  });

  const fetchMutation = useMutation({
    mutationFn: () => fetchRemote(repoId, "origin"),
  });
  const pushMutation = useMutation({
    mutationFn: (force: boolean) => pushBranch(repoId, "origin", branch as string, force),
  });

  const doFetch = () => {
    toast.promise(fetchMutation.mutateAsync(), {
      id: "fetch",
      loading: "Fetching from remote...",
      success: (s) => {
        invalidate();
        return `Fetch complete (${s.receivedObjects} objects)`;
      },
      error: (e) => errorMessage(e),
    });
  };

  const doPush = async (force = false, skipFetch = false) => {
    if (!branch) return;

    if (!skipFetch) {
      toast.loading(`Fetching from remote before push...`, { id: "push" });
      try {
        await fetchMutation.mutateAsync();
      } catch (e) {
        toast.error(`Fetch before push failed: ${errorMessage(e)}`, { id: "push" });
        return;
      }
      invalidate();
      const status = await getRepoStatus(repoId);
      if (status.behind > 0) {
        toast.error(
          `The remote has ${status.behind} commit(s) you don't have locally — pull/merge/rebase before pushing.`,
          { id: "push" },
        );
        return;
      }
    }

    toast.loading(force ? `Force pushing ${branch}...` : `Pushing ${branch}...`, { id: "push" });
    try {
      const s = await pushMutation.mutateAsync(force);
      invalidate();
      toast.success(`Push complete for ${s.branch}`, { id: "push" });
    } catch (e) {
      const err = e as GitCommandError;
      if (!force && err?.kind === "PushRejectedNonFastForward") {
        toast.dismiss("push");
        const confirmed = await confirm(
          "The remote has commits you don't have locally. Force pushing will overwrite the remote history. Continue?",
          { title: "Force push", kind: "warning" },
        );
        if (confirmed) doPush(true, true);
        return;
      }
      toast.error(errorMessage(e), { id: "push" });
    }
  };

  return (
    <>
      <button
        onClick={doFetch}
        disabled={anyMutating}
        className="flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700 disabled:opacity-50"
      >
        {fetchMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}{" "}
        Fetch
      </button>
      <button
        onClick={() => doPush()}
        disabled={!branch || anyMutating}
        className="flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700 disabled:opacity-50"
      >
        {pushMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}{" "}
        Push
      </button>
    </>
  );
}
