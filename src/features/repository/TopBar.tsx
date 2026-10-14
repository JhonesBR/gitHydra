import { useIsMutating } from "@tanstack/react-query";
import { Ellipsis, GitBranch, Loader2, Package, Redo2, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useContextMenu } from "@/components/ContextMenu";
import { Popover } from "@/components/Popover";
import { ScrollStrip } from "@/components/ScrollStrip";
import { useBranchActions } from "@/features/branches/useBranchActions";
import { RemoteOpsButtons } from "@/features/remote-ops/RemoteOpsButtons";
import { RemotesModal } from "@/features/remote-ops/RemotesModal";
import { RepoSshKeyModal } from "@/features/ssh-keys/RepoSshKeyModal";
import { useActivityStore } from "@/features/activity/store";
import { useStashActions } from "@/features/stash/useStashActions";
import type { useUndo } from "@/features/undo/useUndo";
import { formatDateTime } from "@/lib/format-date";
import { useRepoToolsMenu } from "./useRepoToolsMenu";

export function TopBar({
  repoId,
  repoPath,
  branch,
  hasLocalChanges,
  onOpenTree,
  onOpenStats,
  onOpenReflog,
  undo,
}: {
  repoId: string;
  repoPath: string;
  branch: string | null;
  hasLocalChanges: boolean;
  onOpenTree: () => void;
  onOpenStats: () => void;
  onOpenReflog: () => void;
  undo: ReturnType<typeof useUndo>;
}) {
  const { create } = useBranchActions(repoId);
  const [branchName, setBranchName] = useState("");
  const anyMutating = useIsMutating() > 0;
  const { save: stashSave } = useStashActions(repoId);
  const viewsMenu = useContextMenu();
  const [sshKeyOpen, setSshKeyOpen] = useState(false);
  const [remotesOpen, setRemotesOpen] = useState(false);
  const repoTools = useRepoToolsMenu(repoId, repoPath);

  return (
    <div className="flex items-center gap-2 border-b border-neutral-800 bg-neutral-950 px-3 py-2">
      <div className="flex shrink-0 items-center gap-1.5">
        <img src="/logo.svg" alt="" className="block h-5 w-5" />
        <span className="text-sm font-semibold leading-none text-neutral-200">gitHydra</span>
        <span className="text-[10px] leading-none text-neutral-500/70">v{__APP_VERSION__}</span>
      </div>

      <div className="flex shrink-0 items-center">
          <button
            onClick={undo.undo}
            disabled={!undo.canUndo}
            title={undo.status?.undo ? `Undo: ${undo.status.undo} (Ctrl+Z)` : "Nothing to undo"}
            className="rounded-l bg-neutral-800 px-2 py-1.5 text-sm hover:bg-neutral-700 disabled:opacity-50"
          >
            <Undo2 size={14} />
          </button>
          <button
            onClick={undo.redo}
            disabled={!undo.canRedo}
            title={undo.status?.redo ? `Redo: ${undo.status.redo} (Ctrl+Shift+Z)` : "Nothing to redo"}
            className="rounded-r border-l border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm hover:bg-neutral-700 disabled:opacity-50"
          >
            <Redo2 size={14} />
          </button>
        </div>


      <ScrollStrip className="flex-1" edgeClass="from-neutral-950">
        <div className="mx-auto flex w-max items-center gap-2 px-1 [&>*]:shrink-0">
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
                message: `${formatDateTime(new Date())} — WIP on ${branch ?? "detached HEAD"}`,
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
        <button
          onClick={(e) =>
            viewsMenu.open(e, [
              { label: "Tree", onClick: onOpenTree },
              { label: "Statistics", onClick: onOpenStats },
              { label: "Reflog", onClick: onOpenReflog },
              ...repoTools.items,
              { label: "SSH key", onClick: () => setSshKeyOpen(true) },
              { label: "Remotes", onClick: () => setRemotesOpen(true) },
              { label: "Activity Logs (Ctrl+L)", onClick: () => useActivityStore.getState().setOpen(true) },
            ])
          }
          title="Tree, Statistics, Reflog, Worktrees, SSH key, Remotes, Activity Logs"
          className="shrink-0 rounded bg-neutral-800 px-2 py-1.5 hover:bg-neutral-700"
        >
          <Ellipsis size={14} />
        </button>
        {viewsMenu.menu}
        {repoTools.modals}
        {sshKeyOpen && <RepoSshKeyModal repoPath={repoPath} onClose={() => setSshKeyOpen(false)} />}
        {remotesOpen && <RemotesModal repoId={repoId} onClose={() => setRemotesOpen(false)} />}
        </div>
      </ScrollStrip>
    </div>
  );
}
