import { useIsMutating } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { Popover } from "@/components/Popover";
import { RemoteOpsButtons } from "@/features/remote-ops/RemoteOpsButtons";
import { StashPopoverContent } from "@/features/stash/StashPopoverContent";

export function TopBar({ repoId, branch }: { repoId: string; branch: string | null }) {
  const anyMutating = useIsMutating() > 0;

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
