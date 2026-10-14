import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, KeyRound, Loader2, Upload } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { SshKeySelect } from "@/features/ssh-keys/SshKeySelect";
import { toast } from "sonner";
import { confirm } from "@/lib/confirm-store";
import { queryKeys } from "@/lib/query-keys";
import type { GitCommandError } from "@/lib/tauri-client";
import { errorMessage } from "@/lib/tauri-client";
import { useTauriEvent } from "@/lib/tauri-events";
import { fetchRemote, pushBranch } from "./api";
import type { FetchProgressEvent, PushProgressEvent } from "./types";

export function RemoteOpsButtons({
  repoId,
  repoPath,
  branch,
}: {
  repoId: string;
  repoPath: string;
  branch: string | null;
}) {
  const queryClient = useQueryClient();
  const [keyPickerOpen, setKeyPickerOpen] = useState(false);
  const anyMutating = useIsMutating() > 0;

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
    if (p.repoId !== repoId) return;
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
      <button
        onClick={() => setKeyPickerOpen(true)}
        title="SSH key for this repository"
        className="rounded bg-neutral-800 px-2 py-1.5 text-sm hover:bg-neutral-700"
      >
        <KeyRound size={14} />
      </button>
      {keyPickerOpen && (
        <Modal onClose={() => setKeyPickerOpen(false)} width="w-[420px]">
          <div className="p-4">
            <h2 className="mb-1 text-sm font-semibold text-neutral-100">SSH key for this repository</h2>
            <p className="mb-3 break-all text-xs text-neutral-500">{repoPath}</p>
            <SshKeySelect dir={repoPath} />
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setKeyPickerOpen(false)}
                className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 hover:bg-neutral-600"
              >
                Done
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
