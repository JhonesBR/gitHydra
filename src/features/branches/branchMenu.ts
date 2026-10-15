import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import type { useBranchActions } from "./useBranchActions";

/** `remotes`: the remotes this branch exists on (delete items act on each). */
export type MenuTarget = { name: string; isHead: boolean; hasLocal: boolean; remotes: string[] };
type Actions = ReturnType<typeof useBranchActions>;

export const copyNameItem = (kind: "branch" | "tag", name: string) => ({
  label: `Copy ${kind} name`,
  onClick: () => {
    writeText(name);
    toast.success(`${kind === "tag" ? "Tag" : "Branch"} name copied`);
  },
});

/** Branch context-menu / drop-menu items, shared by the commit graph's pills
 * and the sidebar rows. `extra` = items only the caller can build (pin, MR).
 * Rebase moves HEAD on the backend, so it's offered only when `origin` is the
 * checked-out branch; merge and reset check the target out first if needed.
 * Drag-mode (dropping `origin` onto `target`) keeps only the comparison items. */
export function buildBranchMenuItems(
  a: Actions,
  anyMutating: boolean,
  target: MenuTarget,
  origin: string | null,
  originCheckedOut: boolean,
  dragMode: boolean,
  extra: { leading?: { label: string; onClick: () => void }[]; comparison?: { label: string; onClick: () => void }[] } = {},
) {
  const busy = a.rebaseInProgress || anyMutating;
  const other = origin && origin !== target.name ? origin : null;
  return [
    ...(dragMode ? [] : [...(extra.leading ?? []), copyNameItem("branch", target.name)]),
    ...(other && originCheckedOut
      ? [{ label: `Rebase ${other} into ${target.name}`, onClick: () => a.rebaseOnto.mutate(target.name), disabled: busy }]
      : []),
    ...(other
      ? [
          { label: `Merge ${other} into ${target.name}`, onClick: () => a.mergeIntoWithFeedback({ origin: other, target: target.name }), disabled: busy },
          // Drag: the dragged branch is the one that moves, onto the drop target.
          dragMode
            ? { label: `Reset ${other} to ${target.name}`, onClick: () => a.resetBranchToWithConfirm({ origin: target.name, target: other }), disabled: busy }
            : { label: `Reset ${target.name} to ${other}`, onClick: () => a.resetBranchToWithConfirm({ origin: other, target: target.name }), disabled: busy },
        ]
      : []),
    ...(other
      ? [
          {
            label: dragMode
              ? `Compare ${other} with ${target.name}`
              : `Compare with ${other}${originCheckedOut ? " (current branch)" : ""}`,
            onClick: () => a.compareBranches(target.name, other),
          },
        ]
      : []),
    ...(other ? (extra.comparison ?? []) : []),
    ...(dragMode
      ? []
      : [
          ...(target.hasLocal && !target.isHead
            ? [{ label: "Delete local branch", onClick: () => a.deleteLocalWithConfirm(target.name) }]
            : []),
          ...target.remotes.map((remote) => ({
            label: `Delete branch on ${remote}`,
            onClick: () => a.deleteRemoteWithConfirm(target.name, remote),
          })),
          ...(target.hasLocal && target.remotes.length > 0 && !target.isHead
            ? [{ label: `Delete branch (local + ${target.remotes.join(", ")})`, onClick: () => a.deleteBothWithConfirm(target.name, target.remotes) }]
            : []),
        ]),
  ];
}
