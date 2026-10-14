import { useIsMutating } from "@tanstack/react-query";
import { Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/tauri-client";
import { useTauriEvent } from "@/lib/tauri-events";
import type { FetchProgressEvent, PushProgressEvent } from "./types";
import { usePushBranch } from "./usePushBranch";

export function RemoteOpsButtons({ repoId, branch }: { repoId: string; branch: string | null }) {
  const anyMutating = useIsMutating() > 0;
  const { push, fetchMutation, pushMutation, invalidate } = usePushBranch(repoId);

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
        onClick={() => branch && push(branch)}
        disabled={!branch || anyMutating}
        className="flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700 disabled:opacity-50"
      >
        {pushMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}{" "}
        Push
      </button>
    </>
  );
}
