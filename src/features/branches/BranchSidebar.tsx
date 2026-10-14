import { useIsMutating, useQuery } from "@tanstack/react-query";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Archive, Check, ChevronDown, ChevronRight, Cloud, Folder, GitBranch, Monitor, Search, Tag } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useContextMenu } from "@/components/ContextMenu";
import type { StashInfo } from "@/features/stash/types";
import { useStashActions } from "@/features/stash/useStashActions";
import { confirm } from "@/lib/confirm-store";
import { formatDateTime } from "@/lib/format-date";
import { queryKeys } from "@/lib/query-keys";
import { errorMessage } from "@/lib/tauri-client";
import { listBranches, listTags } from "./api";
import { useRemoteTags } from "./useRemoteTags";
import { buildBranchMenuItems } from "./branchMenu";
import { useBranchDragStore } from "@/features/commit-graph/branchDragStore";
import type { BranchInfo, TagInfo } from "./types";
import { useBranchActions } from "./useBranchActions";

type BranchLeaf = { label: string; branch: BranchInfo };

// Tree indentation: each level steps in by INDENT. Leaves add CHEVRON_SLOT
// (chevron 11px + 4px gap) so a branch's icon lines up with the folder icon of
// a sibling folder, and a folder's children start under the folder's name.
const BASE_PAD = 8;
const INDENT = 14;
const CHEVRON_SLOT = 15;
const rowPad = (level: number) => BASE_PAD + level * INDENT;
type BranchFolder = { name: string; path: string; folders: BranchFolder[]; leaves: BranchLeaf[] };

/** Groups names by their "/" segments (feat/x, feat/y → feat ▸ x, y), the way
 * most git clients show branch folders. `prefix` is stripped first (used to
 * drop the "origin/" part of remote branch names). */
function buildFolders(branches: BranchInfo[], prefix: string): BranchFolder {
  const root: BranchFolder = { name: "", path: "", folders: [], leaves: [] };
  for (const branch of branches) {
    const parts = branch.name.slice(prefix.length).split("/");
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      let next = folder.folders.find((f) => f.name === part);
      if (!next) {
        next = { name: part, path: `${folder.path}/${part}`, folders: [], leaves: [] };
        folder.folders.push(next);
      }
      folder = next;
    }
    folder.leaves.push({ label: parts[parts.length - 1], branch });
  }
  const sort = (f: BranchFolder) => {
    f.folders.sort((a, b) => a.name.localeCompare(b.name));
    f.leaves.sort((a, b) => a.label.localeCompare(b.label));
    f.folders.forEach(sort);
  };
  sort(root);
  return root;
}

function SectionHeader({
  label,
  count,
  icon: Icon,
  open,
  onToggle,
}: {
  label: string;
  count: number;
  icon: typeof Monitor;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      style={{ paddingLeft: rowPad(0) }}
      className="flex w-full items-center gap-1 py-1.5 pr-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 hover:bg-neutral-900"
    >
      {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      <Icon size={11} />
      <span className="flex-1 text-left">{label}</span>
      <span className="font-normal text-neutral-500">{count}</span>
    </button>
  );
}

export function BranchSidebar({
  repoId,
  currentBranch,
  selectedStashSha,
  onSelectStash,
}: {
  repoId: string;
  currentBranch: string | null;
  selectedStashSha: string | null;
  onSelectStash: (stash: StashInfo) => void;
}) {
  const { data: branches } = useQuery({
    queryKey: queryKeys.branches(repoId),
    queryFn: () => listBranches(repoId),
  });
  const { data: tags } = useQuery({
    queryKey: queryKeys.tags(repoId),
    queryFn: () => listTags(repoId),
  });
  const branchActions = useBranchActions(repoId);
  const { checkoutWithFeedback, checkoutAtWithFeedback, checkoutDetachedWithFeedback, localBranchNames, pushTagToOrigin, deleteTagLocal, deleteTagOnOrigin } =
    branchActions;
  const draggingBranch = useBranchDragStore((s) => s.draggingBranch);
  const startDrag = useBranchDragStore((s) => s.start);
  const stopDrag = useBranchDragStore((s) => s.stop);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const anyMutating = useIsMutating() > 0;
  const { stashes, apply: stashApply, pop: stashPop, drop: stashDrop } = useStashActions(repoId);
  const { open: openMenu, menu } = useContextMenu();
  const [filter, setFilter] = useState("");
  // Collapsed sections/folders, keyed "local", "remote:origin", "local/feat"...
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Selected branch by its short name ("feat/x"), so clicking either the local
  // branch or "origin/feat/x" marks both of them.
  const [selected, setSelected] = useState<string | null>(null);
  const hasOrigin = (branches ?? []).some((b) => b.isRemote && b.name.startsWith("origin/"));
  // Which tags exist on origin (network call; failures just mean "unknown").
  const remoteTags = useRemoteTags(repoId, hasOrigin);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const { local, remotes } = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const matching = (branches ?? []).filter((b) => !needle || b.name.toLowerCase().includes(needle));
    const byRemote = new Map<string, BranchInfo[]>();
    for (const b of matching.filter((b) => b.isRemote)) {
      const remote = b.name.split("/")[0];
      byRemote.set(remote, [...(byRemote.get(remote) ?? []), b]);
    }
    return {
      local: matching.filter((b) => !b.isRemote),
      remotes: [...byRemote.entries()].sort(([a], [b]) => a.localeCompare(b)),
    };
  }, [branches, filter]);

  const visibleTags = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (tags ?? []).filter((t) => !needle || t.name.toLowerCase().includes(needle));
  }, [tags, filter]);

  const onTagContextMenu = (e: React.MouseEvent, tag: TagInfo) =>
    openMenu(e, [
      {
        label: "Checkout (detached HEAD)",
        onClick: () => checkoutDetachedWithFeedback(tag.targetSha),
        disabled: anyMutating,
      },
      {
        label: "Copy tag name",
        onClick: () => {
          writeText(tag.name);
          toast.success("Tag name copied");
        },
      },
      ...(hasOrigin && remoteTags
        ? remoteTags.includes(tag.name)
          ? [
              {
                label: "Delete tag on origin",
                onClick: async () => {
                  if (await confirm(`Delete tag "${tag.name}" on origin?`, { title: "Delete tag", kind: "warning" }))
                    deleteTagOnOrigin.mutate(tag.name);
                },
                disabled: anyMutating,
              },
            ]
          : [
              {
                label: "Push tag to origin",
                onClick: () =>
                  toast.promise(pushTagToOrigin.mutateAsync(tag.name), {
                    loading: `Pushing ${tag.name}...`,
                    success: `Tag ${tag.name} pushed`,
                    error: (e) => errorMessage(e),
                  }),
                disabled: anyMutating,
              },
            ]
        : []),
      {
        label: "Delete tag locally",
        onClick: async () => {
          if (await confirm(`Delete local tag "${tag.name}"?`, { title: "Delete tag", kind: "warning" }))
            deleteTagLocal.mutate(tag.name);
        },
        disabled: anyMutating,
      },
    ]);

  const visibleStashes = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (stashes ?? []).filter((s) => !needle || s.message.toLowerCase().includes(needle));
  }, [stashes, filter]);

  // Same actions as a stash row's context menu in the commit graph.
  const onStashContextMenu = (e: React.MouseEvent, stash: StashInfo) =>
    openMenu(e, [
      { label: "Apply", onClick: () => stashApply.mutate(stash.index), disabled: anyMutating },
      { label: "Pop", onClick: () => stashPop.mutate(stash.index), disabled: anyMutating },
      {
        label: "Delete",
        onClick: async () => {
          const confirmed = await confirm(`Delete stash "${stash.message}"? This action cannot be undone.`, {
            title: "Delete stash",
            kind: "warning",
          });
          if (confirmed) stashDrop.mutate(stash.index);
        },
        disabled: anyMutating,
      },
    ]);

  const onDoubleClick = (branch: BranchInfo, remote: string | null) => {
    if (anyMutating) return;
    if (!remote) {
      if (branch.name !== currentBranch) checkoutWithFeedback(branch.name);
      return;
    }
    // Remote branch: switch to the local branch of the same name if there is
    // one (never moves it), otherwise create it tracking the remote.
    const name = branch.name.slice(remote.length + 1);
    if (localBranchNames.has(name)) {
      if (name !== currentBranch) checkoutWithFeedback(name);
    } else {
      checkoutAtWithFeedback({ name, targetSha: branch.targetSha, remoteName: remote });
    }
  };

  const remoteBranchNames = useMemo(
    () => new Set((branches ?? []).filter((b) => b.isRemote).map((b) => b.name.slice(b.name.indexOf("/") + 1))),
    [branches],
  );
  const menuTarget = (name: string) => ({
    name,
    isHead: name === currentBranch,
    hasLocal: localBranchNames.has(name),
    hasRemote: remoteBranchNames.has(name),
  });
  // Same actions as the graph's branch pills (minus pin / merge-request items).
  const onBranchContextMenu = (e: React.MouseEvent, name: string) =>
    openMenu(e, buildBranchMenuItems(branchActions, anyMutating, menuTarget(name), currentBranch, true, false));
  const onBranchMouseDown = (e: React.MouseEvent, name: string) => {
    if (e.button !== 0) return;
    const { clientX: x0, clientY: y0 } = e;
    const onMove = (ev: globalThis.MouseEvent) => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      cleanup();
      startDrag(name, ev.clientX, ev.clientY);
    };
    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", cleanup);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", cleanup);
  };
  const onBranchMouseUp = (e: React.MouseEvent, name: string) => {
    const dragging = useBranchDragStore.getState().draggingBranch;
    stopDrag();
    setDropTarget(null);
    if (!dragging || dragging === name) return;
    const items = buildBranchMenuItems(branchActions, anyMutating, menuTarget(name), dragging, dragging === currentBranch, true);
    if (items.length) openMenu(e, items);
  };

  const renderFolder = (folder: BranchFolder, keyPrefix: string, remote: string | null, depth: number) => (
    <ul>
      {folder.folders.map((sub) => {
        const key = `${keyPrefix}${sub.path}`;
        const isOpen = !collapsed.has(key);
        return (
          <li key={key}>
            <button
              onClick={() => toggle(key)}
              className="flex w-full items-center gap-1 py-0.5 pr-2 text-xs text-neutral-400 hover:bg-neutral-900"
              style={{ paddingLeft: rowPad(depth) }}
            >
              {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              <Folder size={11} className="shrink-0" />
              <span className="truncate">{sub.name}</span>
            </button>
            {isOpen && renderFolder(sub, keyPrefix, remote, depth + 1)}
          </li>
        );
      })}
      {folder.leaves.map(({ label, branch }) => {
        const shortName = remote ? branch.name.slice(remote.length + 1) : branch.name;
        // The checked-out branch and its remote counterpart share the HEAD
        // color; only the local one gets the check mark.
        const isCurrent = shortName === currentBranch;
        const isSelected = shortName === selected;
        return (
          <li key={branch.name}>
            <div
              onClick={() => setSelected(isSelected ? null : shortName)}
              onDoubleClick={() => onDoubleClick(branch, remote)}
              onContextMenu={(e) => onBranchContextMenu(e, shortName)}
              onMouseDown={(e) => onBranchMouseDown(e, shortName)}
              onMouseUp={(e) => onBranchMouseUp(e, shortName)}
              onMouseEnter={() => draggingBranch && draggingBranch !== shortName && setDropTarget(branch.name)}
              onMouseLeave={() => setDropTarget(null)}
              title={`${branch.name}\nDouble-click: checkout · Drag onto another branch to merge/rebase/reset`}
              className={`flex cursor-pointer items-center gap-1 py-0.5 pr-2 text-xs select-none ${
                isCurrent ? "font-semibold" : isSelected ? "bg-neutral-800 text-neutral-100" : "text-neutral-300 hover:bg-neutral-900"
              }`}
              style={{
                paddingLeft: rowPad(depth) + CHEVRON_SLOT,
                ...(isCurrent && {
                  color: "color-mix(in srgb, var(--head-color) 70%, var(--color-neutral-100))",
                  backgroundColor: `color-mix(in srgb, var(--head-color) ${isSelected ? 28 : 15}%, transparent)`,
                }),
                // Selection marker: an accent bar on the left edge, shown on the
                // local branch and its remote twin alike.
                ...(isSelected && { boxShadow: "inset 2px 0 0 var(--color-blue-500)" }),
                ...(draggingBranch && dropTarget === branch.name && {
                  outline: "2px solid var(--color-blue-400)",
                  outlineOffset: "-2px",
                }),
              }}
            >
              {isCurrent && !remote ? (
                <Check size={11} className="shrink-0" />
              ) : (
                <GitBranch size={11} className="shrink-0 opacity-60" />
              )}
              <span className="truncate">{label}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-neutral-950 text-sm">
      <div className="shrink-0 border-b border-neutral-800 p-2">
        <label className="flex items-center gap-1.5 rounded bg-neutral-900 px-2 py-1 text-neutral-500">
          <Search size={12} className="shrink-0" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.currentTarget.value)}
            placeholder="Filter branches"
            className="min-w-0 flex-1 bg-transparent text-xs text-neutral-200 outline-none placeholder:text-neutral-500"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        <SectionHeader
          label="Local"
          count={local.length}
          icon={Monitor}
          open={!collapsed.has("local")}
          onToggle={() => toggle("local")}
        />
        {!collapsed.has("local") && renderFolder(buildFolders(local, ""), "local", null, 1)}

        <SectionHeader
          label="Remote"
          count={remotes.reduce((n, [, list]) => n + list.length, 0)}
          icon={Cloud}
          open={!collapsed.has("remote")}
          onToggle={() => toggle("remote")}
        />
        {!collapsed.has("remote") &&
          remotes.map(([remote, list]) => {
            const key = `remote:${remote}`;
            const isOpen = !collapsed.has(key);
            return (
              <div key={key}>
                <button
                  onClick={() => toggle(key)}
                  className="flex w-full items-center gap-1 py-0.5 pr-2 text-xs text-neutral-300 hover:bg-neutral-900"
                  style={{ paddingLeft: rowPad(1) }}
                >
                  {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  <Cloud size={11} className="shrink-0" />
                  <span className="flex-1 truncate text-left">{remote}</span>
                  <span className="text-neutral-500">{list.length}</span>
                </button>
                {isOpen && renderFolder(buildFolders(list, `${remote}/`), key, remote, 2)}
              </div>
            );
          })}

        <SectionHeader
          label="Tags"
          count={visibleTags.length}
          icon={Tag}
          open={!collapsed.has("tags")}
          onToggle={() => toggle("tags")}
        />
        {!collapsed.has("tags") && (
          <ul>
            {visibleTags.map((tag) => {
              const isSelected = tag.name === selectedTag;
              return (
                <li key={tag.name}>
                  <div
                    onClick={() => setSelectedTag(isSelected ? null : tag.name)}
                    onDoubleClick={() => !anyMutating && checkoutDetachedWithFeedback(tag.targetSha)}
                    onContextMenu={(e) => onTagContextMenu(e, tag)}
                    title={`${tag.name} · ${tag.targetSha.slice(0, 7)} · ${formatDateTime(tag.date)}\nDouble-click: checkout (detached HEAD)`}
                    className={`flex cursor-pointer items-center gap-1 py-0.5 pr-2 text-xs select-none ${
                      isSelected ? "bg-neutral-800 text-neutral-100" : "text-neutral-300 hover:bg-neutral-900"
                    }`}
                    style={{
                      paddingLeft: rowPad(1) + CHEVRON_SLOT,
                      ...(isSelected && { boxShadow: "inset 2px 0 0 var(--color-blue-500)" }),
                    }}
                  >
                    <Tag size={11} className="shrink-0 opacity-60" />
                    <span className="truncate">{tag.name}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <SectionHeader
          label="Stashes"
          count={visibleStashes.length}
          icon={Archive}
          open={!collapsed.has("stashes")}
          onToggle={() => toggle("stashes")}
        />
        {!collapsed.has("stashes") && (
          <ul>
            {visibleStashes.map((stash) => {
              const isSelected = stash.sha === selectedStashSha;
              return (
                <li key={stash.sha}>
                  <div
                    onClick={() => onSelectStash(stash)}
                    onContextMenu={(e) => onStashContextMenu(e, stash)}
                    title={`stash@{${stash.index}}: ${stash.message}`}
                    className={`flex cursor-pointer items-center gap-1 py-0.5 pr-2 text-xs select-none ${
                      isSelected ? "bg-neutral-800 text-neutral-100" : "text-neutral-300 hover:bg-neutral-900"
                    }`}
                    style={{
                      paddingLeft: rowPad(1) + CHEVRON_SLOT,
                      ...(isSelected && { boxShadow: "inset 2px 0 0 var(--color-blue-500)" }),
                    }}
                  >
                    <Archive size={11} className="shrink-0 opacity-60" />
                    <span className="truncate">{stash.message}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {menu}
    </div>
  );
}
