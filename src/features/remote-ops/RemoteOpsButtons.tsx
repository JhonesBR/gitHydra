import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Cloud, Download, Loader2, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useContextMenu } from "@/components/ContextMenu";
import { Modal } from "@/components/Modal";
import { confirm } from "@/lib/confirm-store";
import { queryKeys } from "@/lib/query-keys";
import type { GitCommandError } from "@/lib/tauri-client";
import { errorMessage } from "@/lib/tauri-client";
import { useTauriEvent } from "@/lib/tauri-events";
import { fetchRemote, pushBranch } from "./api";
import type { FetchProgressEvent, PushProgressEvent } from "./types";
import { useRemotes } from "./useRemotes";

export function RemoteOpsButtons({ repoId, branch }: { repoId: string; branch: string | null }) {
  const queryClient = useQueryClient();
  const anyMutating = useIsMutating() > 0;
  const remoteNames = (useRemotes(repoId).data ?? []).map((r) => r.name);
  const fetchMenu = useContextMenu();
  // Push target picker, when the branch has no upstream and there's no `origin`.
  const [picking, setPicking] = useState<{ remotes: string[]; resolve: (r: string | null) => void } | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.branches(repoId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.commitLog(repoId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.headCommit(repoId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.repoStatus(repoId) });
  };

  // Plain toasts, not `.loading(...)` — sonner hardcodes no close button for
  // loading-type toasts, but these can run long (a big fetch) and closing the
  // toast doesn't cancel the operation, so the user should be free to dismiss it.
  useTauriEvent<FetchProgressEvent>("git://fetch-progress", (p) => {
    if (p.repoId !== repoId || p.background) return;
    toast(`Fetch: ${p.receivedObjects}/${p.totalObjects} objects`, {
      id: "fetch",
      icon: <Loader2 size={14} className="animate-spin" />,
    });
  });
  useTauriEvent<PushProgressEvent>("git://push-progress", (p) => {
    if (p.repoId !== repoId) return;
    toast(`Push: ${p.current}/${p.total}`, {
      id: "push",
      icon: <Loader2 size={14} className="animate-spin" />,
    });
  });

  /** null: every remote. */
  const fetchMutation = useMutation({
    mutationFn: (remote: string | null) => fetchRemote(repoId, remote),
  });
  const pushMutation = useMutation({
    mutationFn: (vars: { remote: string | null; force: boolean }) =>
      pushBranch(repoId, vars.remote, branch as string, vars.force),
  });

  const doFetch = (remote: string | null = null) => {
    toast.promise(fetchMutation.mutateAsync(remote), {
      id: "fetch",
      loading: remote ? `Fetching from ${remote}...` : "Fetching from all remotes...",
      success: (s) => {
        invalidate();
        return `Fetch complete (${s.receivedObjects} objects)`;
      },
      // Some remotes may still have been fetched.
      error: (e) => {
        invalidate();
        return errorMessage(e);
      },
    });
  };

  const pickRemote = (remotes: string[]) =>
    new Promise<string | null>((resolve) => setPicking({ remotes, resolve }));

  /** `remote` null: the branch's upstream remote, else origin, else the only one — asks when ambiguous. */
  const doPush = async (force = false, skipFetch = false, remote: string | null = null) => {
    if (!branch) return;

    if (!skipFetch) {
      toast.loading(`Fetching before push...`, { id: "push" });
      try {
        await fetchMutation.mutateAsync(remote);
      } catch (e) {
        // With several remotes, one being down mustn't block pushing to another.
        if (remote || remoteNames.length <= 1) {
          toast.error(`Fetch before push failed: ${errorMessage(e)}`, { id: "push" });
          return;
        }
      }
      invalidate();
    }

    toast.loading(force ? `Force pushing ${branch}...` : `Pushing ${branch}...`, { id: "push" });
    try {
      const s = await pushMutation.mutateAsync({ remote, force });
      invalidate();
      toast.success(`Pushed ${s.branch} to ${s.remoteName}`, { id: "push" });
    } catch (e) {
      const err = e as GitCommandError;
      if (err?.kind === "RemoteRequired" && err.details.remotes.length > 0) {
        toast.dismiss("push");
        const chosen = await pickRemote(err.details.remotes);
        if (chosen) doPush(force, true, chosen);
        return;
      }
      if (!force && err?.kind === "PushRejectedNonFastForward") {
        toast.dismiss("push");
        const confirmed = await confirm(
          "The remote has commits you don't have locally. Force pushing will overwrite the remote history. Continue?",
          { title: "Force push", kind: "warning" },
        );
        if (confirmed) doPush(true, true, remote);
        return;
      }
      toast.error(errorMessage(e), { id: "push" });
    }
  };

  const answerPick = (remote: string | null) => {
    picking?.resolve(remote);
    setPicking(null);
  };

  return (
    <>
      <div className="flex items-center">
        <button
          onClick={() => doFetch()}
          disabled={anyMutating}
          title={remoteNames.length > 1 ? "Fetch all remotes" : undefined}
          className={`flex items-center gap-1.5 bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700 disabled:opacity-50 ${
            remoteNames.length > 1 ? "rounded-l" : "rounded"
          }`}
        >
          {fetchMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}{" "}
          Fetch
        </button>
        {remoteNames.length > 1 && (
          <button
            onClick={(e) =>
              fetchMenu.open(e, [
                { label: "Fetch all remotes", onClick: () => doFetch() },
                ...remoteNames.map((name) => ({ label: `Fetch ${name}`, onClick: () => doFetch(name) })),
              ])
            }
            disabled={anyMutating}
            title="Fetch one remote"
            className="self-stretch rounded-r border-l border-neutral-700 bg-neutral-800 px-1 hover:bg-neutral-700 disabled:opacity-50"
          >
            <ChevronDown size={12} />
          </button>
        )}
      </div>
      {fetchMenu.menu}
      <button
        onClick={() => doPush()}
        disabled={!branch || anyMutating}
        className="flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700 disabled:opacity-50"
      >
        {pushMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}{" "}
        Push
      </button>
      {picking && (
        <Modal onClose={() => answerPick(null)} width="w-[360px]">
          <div className="p-4">
            <h2 className="mb-1 text-sm font-semibold text-neutral-100">Push {branch} to</h2>
            <p className="mb-3 text-xs text-neutral-500">
              The branch has no upstream yet; the remote you pick becomes it.
            </p>
            <div className="flex flex-col gap-1">
              {picking.remotes.map((name) => (
                <button
                  key={name}
                  onClick={() => answerPick(name)}
                  className="flex items-center gap-2 rounded bg-neutral-800 px-3 py-1.5 text-left text-sm text-neutral-100 hover:bg-neutral-700"
                >
                  <Cloud size={13} className="shrink-0 text-neutral-400" /> {name}
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => answerPick(null)}
                className="rounded bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
