import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ContextMenuItem } from "@/components/ContextMenu";
import { listSubmodules, submodulesKey } from "@/features/submodules/api";
import { SubmodulesModal } from "@/features/submodules/SubmodulesModal";
import { WorktreesModal } from "@/features/worktrees/WorktreesModal";

/** Worktrees / Submodules entries for the repo "..." menu, plus their modals.
 * Submodules only shows up when the repo has any. */
export function useRepoToolsMenu(repoId: string, repoPath: string) {
  const [open, setOpen] = useState<"worktrees" | "submodules" | null>(null);
  const { data: submodules } = useQuery({
    queryKey: submodulesKey(repoId),
    queryFn: () => listSubmodules(repoId),
    // Only decides whether the entry is shown; the modal refreshes on open.
    staleTime: 5 * 60_000,
  });

  const items: ContextMenuItem[] = [
    { label: "Worktrees", onClick: () => setOpen("worktrees") },
    ...(submodules?.length ? [{ label: `Submodules (${submodules.length})`, onClick: () => setOpen("submodules") }] : []),
  ];

  const close = () => setOpen(null);
  const modals =
    open === "worktrees" ? (
      <WorktreesModal repoId={repoId} repoPath={repoPath} onClose={close} />
    ) : open === "submodules" ? (
      <SubmodulesModal repoId={repoId} onClose={close} />
    ) : null;

  return { items, modals };
}
