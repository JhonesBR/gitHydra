import type { RefInfo } from "./types";

export type GroupedRef = {
  name: string;
  isHead: boolean;
  isTag: boolean;
  hasLocal: boolean;
  hasRemote: boolean;
};

/** Merges a local branch and its remote-tracking counterpart (e.g. "main" +
 * "origin/main") into a single pill for the same commit row. */
export function groupRefs(refs: RefInfo[]): GroupedRef[] {
  const byKey = new Map<string, GroupedRef>();

  for (const ref of refs) {
    if (ref.kind === "Tag") {
      byKey.set(`tag:${ref.name}`, {
        name: ref.name,
        isHead: false,
        isTag: true,
        hasLocal: false,
        hasRemote: false,
      });
      continue;
    }

    if (ref.kind === "DetachedHead") {
      byKey.set(`head:${ref.name}`, {
        name: ref.name,
        isHead: true,
        isTag: false,
        hasLocal: false,
        hasRemote: false,
      });
      continue;
    }

    const baseName = ref.kind === "RemoteBranch" ? stripRemotePrefix(ref.name) : ref.name;
    const key = `branch:${baseName}`;
    const existing = byKey.get(key) ?? {
      name: baseName,
      isHead: false,
      isTag: false,
      hasLocal: false,
      hasRemote: false,
    };
    if (ref.kind === "LocalBranch") {
      existing.hasLocal = true;
      existing.isHead = existing.isHead || ref.isHead;
    } else {
      existing.hasRemote = true;
    }
    byKey.set(key, existing);
  }

  return [...byKey.values()];
}

function stripRemotePrefix(name: string): string {
  const idx = name.indexOf("/");
  return idx === -1 ? name : name.slice(idx + 1);
}
