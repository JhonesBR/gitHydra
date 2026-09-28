import { useIsMutating } from "@tanstack/react-query";
import { GitBranch, Loader2, Package } from "lucide-react";
import { useState } from "react";
import { Popover } from "@/components/Popover";
import { useBranchActions } from "@/features/branches/useBranchActions";
import { RemoteOpsButtons } from "@/features/remote-ops/RemoteOpsButtons";
import { StashPopoverContent } from "@/features/stash/StashPopoverContent";

export function TopBar({ repoId, branch }: { repoId: string; branch: string | null }) {
  const { create } = useBranchActions(repoId);
  const [branchName, setBranchName] = useState("");
  const anyMutating = useIsMutating() > 0;

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-neutral-800 bg-neutral-950 px-3 py-2">
      <div className="flex shrink-0 items-center gap-1.5 justify-self-start">
        <img src="/logo.svg" alt="" className="block h-5 w-5" />
        <span className="text-sm font-semibold leading-none text-neutral-200">GitHidra</span>
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

        <Popover
          trigger={(p) => (
            <button
              {...p}
              disabled={anyMutating}
              className="flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700 disabled:opacity-50"
            >
              <Package size={14} /> Stash
            </button>
          )}
        >
          <StashPopoverContent repoId={repoId} />
        </Popover>
      </div>

      <div />
    </div>
  );
}
