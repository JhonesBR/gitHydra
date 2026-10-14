import { defaultRemote } from "@/features/remote-ops/remotes";
import type { useBranchActions } from "./useBranchActions";

/** `remotes`: the remotes this branch exists on (delete items act on each). */
export type MenuTarget = { name: string; isHead: boolean; hasLocal: boolean; remotes: string[] };
type Actions = ReturnType<typeof useBranchActions>;

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
  const bothRemote = defaultRemote(target.remotes);
  return [
    ...(dragMode ? [] : (extra.leading ?? [])),
    ...(other && originCheckedOut
      ? [{ label: `Rebase ${other} into ${target.name}`, onClick: () => a.rebaseOnto.mutate(target.name), disabled: busy }]
      : []),
    ...(other
      ? [
          { label: `Merge ${other} into ${target.name}`, onClick: () => a.mergeIntoWithFeedback({ origin: other, target: target.name }), disabled: busy },
          { label: `Reset ${target.name} to ${other}`, onClick: () => a.resetBranchToWithConfirm({ origin: other, target: target.name }), disabled: busy },
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
          ...(target.hasLocal && bothRemote && !target.isHead
            ? [{ label: `Delete branch (local + ${bothRemote})`, onClick: () => a.deleteBothWithConfirm(target.name, bothRemote) }]
            : []),
        ]),
  ];
}
