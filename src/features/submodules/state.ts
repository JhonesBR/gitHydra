import type { SubmoduleInfo, SubmoduleState } from "./api";

export const STATE_LABELS: Record<SubmoduleState, string> = {
  uninitialized: "not checked out",
  outOfDate: "different commit",
  dirty: "modified",
  upToDate: "up to date",
};

/** What "Update all" acts on: not checked out yet, or on another commit.
 * Modified ones are skipped so work in progress inside them isn't disturbed. */
export function needsUpdate(submodules: SubmoduleInfo[]): SubmoduleInfo[] {
  return submodules.filter(canUpdate);
}

/** Up to date or only modified inside: an update would have nothing to do
 * (it checks out the commit already there, keeping local edits). */
export function canUpdate(submodule: SubmoduleInfo): boolean {
  return submodule.state === "uninitialized" || submodule.state === "outOfDate";
}

export function canOpen(submodule: SubmoduleInfo): boolean {
  return submodule.state !== "uninitialized";
}
