import { useIsMutating } from "@tanstack/react-query";
import { GitBranch, Loader2, Package } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Popover } from "@/components/Popover";
import { useBranchActions } from "@/features/branches/useBranchActions";
import { RemoteOpsButtons } from "@/features/remote-ops/RemoteOpsButtons";
import { useStashActions } from "@/features/stash/useStashActions";

/** e.g. "13/10/2026, 14:32" — in the user's locale, without seconds. */
const formatStashDate = (date: Date) =>
  date.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

export function TopBar({
  repoId,
  branch,
  hasLocalChanges,
}: {
  repoId: string;
  branch: string | null;
  hasLocalChanges: boolean;
}) {
  const { create } = useBranchActions(repoId);
  const [branchName, setBranchName] = useState("");
  const anyMutating = useIsMutating() > 0;
  const { save: stashSave } = useStashActions(repoId);

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-neutral-800 bg-neutral-950 px-3 py-2">
      <div className="flex shrink-0 items-center gap-1.5 justify-self-start">
        <img src="/logo.svg" alt="" className="block h-5 w-5" />
        <span className="text-sm font-semibold leading-none text-neutral-200">gitHydra</span>
      </div>

      <div className="flex items-center gap-2 justify-self-center">
        <RemoteOpsButtons repoId={repoId} branch={branch} />

        <Popover
          trigger={(p) => (
            <button
              {...p}
              disabled={anyMutating}
              className="flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700 disabled:opacity-50"
            >
              <GitBranch size={14} /> Branch
            </button>
          )}
        >
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!branchName.trim()) return;
              create.mutate({ name: branchName.trim(), startPoint: null });
              setBranchName("");
            }}
          >
            <input
              autoFocus
              value={branchName}
              onChange={(e) => setBranchName(e.currentTarget.value)}
              placeholder="branch name"
              className="min-w-0 flex-1 rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
            />
            <button
              type="submit"
              disabled={anyMutating}
              className="flex shrink-0 items-center gap-1 rounded bg-neutral-700 px-2 py-1 text-sm hover:bg-neutral-600 disabled:opacity-50"
            >
              {create.isPending && <Loader2 size={12} className="animate-spin" />} Create
            </button>
          </form>
        </Popover>

        {/* One click: stash everything (untracked included). The message leads
            with the date/time so it's the first thing visible in the branches
            sidebar's Stashes list, where the newest stash sits on top. */}
        <button
          onClick={() =>
            stashSave.mutate(
              {
                message: `${formatStashDate(new Date())} — WIP on ${branch ?? "detached HEAD"}`,
                includeUntracked: true,
              },
              { onSuccess: () => toast.success("Changes stashed") },
            )
          }
          disabled={anyMutating || !hasLocalChanges}
          title={hasLocalChanges ? "Stash all changes" : "No local changes to stash"}
          className="flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700 disabled:opacity-50"
        >
          {stashSave.isPending ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} />} Stash
        </button>
      </div>

      <div />
    </div>
  );
}
