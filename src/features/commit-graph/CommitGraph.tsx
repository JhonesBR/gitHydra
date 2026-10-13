import { useInfiniteQuery, useIsMutating } from "@tanstack/react-query";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Archive, Check, Cloud, GitMerge, Loader2, Monitor, Pencil, Tag } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { toast } from "sonner";
import { useContextMenu } from "@/components/ContextMenu";
import { ResizeHandle } from "@/components/ResizeHandle";
import { CreateBranchModal } from "@/features/branches/CreateBranchModal";
import { useBranchActions } from "@/features/branches/useBranchActions";
import { CreateMergeRequestModal } from "@/features/integrations/CreateMergeRequestModal";
import type { GitLabInstance, MergeRequestInfo } from "@/features/integrations/types";
import { useGitLabRemote } from "@/features/integrations/useGitLabRemote";
import { useOpenMergeRequests } from "@/features/integrations/useOpenMergeRequests";
import type { StashInfo } from "@/features/stash/types";
import { useStashActions } from "@/features/stash/useStashActions";
import { confirm } from "@/lib/confirm-store";
import { gravatarUrl } from "@/lib/gravatar";
import { queryKeys } from "@/lib/query-keys";
import { usePersistedNumber, usePersistedValue } from "@/lib/use-persisted-config";
import { getCommitLog } from "./api";
import { computeLanes, type LaneInput } from "./lanes";
import { groupRefs, type GroupedRef } from "./refGroups";
import type { CommitNode, GraphSelection, RefInfo } from "./types";

type GraphRowEntry =
  | { kind: "commit"; commit: CommitNode }
  | { kind: "wip" }
  | { kind: "stash"; stash: StashInfo };

const PAGE_SIZE = 200;
const ROW_HEIGHT = 28;
const LANE_WIDTH = 16;
const AVATAR_SIZE = 16;
// Lane colors. Lime instead of a plain green, so no lane can be mistaken for
// the checked-out branch's HEAD_COLOR.
const PALETTE = ["#22d3ee", "#a78bfa", "#f472b6", "#fb923c", "#a3e635", "#facc15", "#60a5fa", "#f87171"];
// Reserved for the checked-out branch's ref pill (and the repo header / branch
// sidebar) — a CSS var so light themes can darken it. Its graph line keeps
// its lane color; it's only drawn slightly thicker.
const HEAD_COLOR = "var(--head-color)";

/** Path from A through corner C to B with the corner rounded (radius capped
 * by both legs), instead of a hard right angle — smooth bends. */
function elbowPath(ax: number, ay: number, cx: number, cy: number, bx: number, by: number): string {
  const r = Math.min(LANE_WIDTH * 0.75, Math.hypot(cx - ax, cy - ay), Math.hypot(bx - cx, by - cy));
  const inX = Math.sign(cx - ax);
  const inY = Math.sign(cy - ay);
  const outX = Math.sign(bx - cx);
  const outY = Math.sign(by - cy);
  return `M ${ax} ${ay} L ${cx - inX * r} ${cy - inY * r} Q ${cx} ${cy} ${cx + outX * r} ${cy + outY * r} L ${bx} ${by}`;
}

function BranchPill({
  group,
  repoId,
  targetSha,
  localBranchNames,
  currentBranch,
  gitlabInstance,
  openMr,
  onCreateMr,
  headColor,
  pinnedBranch,
  onTogglePin,
}: {
  group: GroupedRef;
  repoId: string;
  targetSha: string;
  localBranchNames: Set<string>;
  currentBranch: string | null;
  gitlabInstance: GitLabInstance | null;
  openMr: MergeRequestInfo | undefined;
  onCreateMr: (branchName: string) => void;
  headColor: string;
  pinnedBranch: string | null;
  onTogglePin: (branchName: string) => void;
}) {
  const {
    checkout,
    checkoutAtCommit,
    checkoutWithFeedback,
    checkoutAtWithFeedback,
    rebaseOnto,
    rebaseInProgress,
    syncToRemote,
    syncToRemoteWithFeedback,
    merge,
    mergeWithFeedback,
    deleteLocalWithConfirm,
    deleteRemoteWithConfirm,
    deleteBothWithConfirm,
  } = useBranchActions(repoId);
  const { open, menu } = useContextMenu();
  const anyMutating = useIsMutating() > 0;
  const isPending =
    checkout.isPending ||
    checkoutAtCommit.isPending ||
    rebaseOnto.isPending ||
    syncToRemote.isPending ||
    merge.isPending;

  const handleDoubleClick = async () => {
    if (group.isTag || group.isHead || anyMutating) return;
    if (group.hasLocal) {
      checkoutWithFeedback(group.name);
      return;
    }
    // Remote-only ref: if a local branch with this name exists elsewhere, checking
    // it out here means resetting it to this commit — confirm before doing that.
    const existsElsewhere = localBranchNames.has(group.name);
    if (existsElsewhere && group.name === currentBranch) {
      // Already checked out on this exact branch and its remote counterpart
      // has moved — sync in place (autostash, hard reset, re-apply) instead
      // of the generic "move a different local branch here" flow below.
      syncToRemoteWithFeedback(targetSha);
      return;
    }
    if (existsElsewhere) {
      const confirmed = await confirm(
        `Branch "${group.name}" already exists locally on another commit. Checking out here will reset it to this commit. Continue?`,
        { title: "Reset branch", kind: "warning" },
      );
      if (!confirmed) return;
    }
    checkoutAtWithFeedback({ name: group.name, targetSha, remoteName: "origin" });
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (group.isTag) return;
    const items = [
      {
        label: pinnedBranch === group.name ? "Unpin from the left" : "Pin branch to the left",
        onClick: () => onTogglePin(group.name),
      },
      ...(!group.isHead && currentBranch
        ? [
            {
              label: `Rebase ${currentBranch} into ${group.name}`,
              onClick: () => rebaseOnto.mutate(group.name),
              disabled: rebaseInProgress || anyMutating,
            },
            {
              label: `Merge ${group.name} into ${currentBranch}`,
              onClick: () => mergeWithFeedback(group.name),
              disabled: rebaseInProgress || anyMutating,
            },
          ]
        : []),
      ...(gitlabInstance && !group.isHead && currentBranch
        ? [
            {
              label: `Create merge request: ${currentBranch} into ${group.name}`,
              onClick: () => onCreateMr(group.name),
            },
          ]
        : []),
      ...(openMr ? [{ label: "Open merge request in GitLab", onClick: () => openUrl(openMr.webUrl) }] : []),
      ...(group.hasLocal && !group.isHead
        ? [{ label: "Delete local branch", onClick: () => deleteLocalWithConfirm(group.name) }]
        : []),
      ...(group.hasRemote
        ? [{ label: "Delete branch on origin", onClick: () => deleteRemoteWithConfirm(group.name) }]
        : []),
      ...(group.hasLocal && group.hasRemote && !group.isHead
        ? [
            {
              label: "Delete branch (local + origin)",
              onClick: () => deleteBothWithConfirm(group.name),
            },
          ]
        : []),
    ];
    if (items.length === 0) return;
    open(e, items);
  };

  return (
    <span
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      title={group.isTag ? group.name : `Double-click: checkout ${group.name}`}
      className={`inline-flex max-w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-xs select-none ${
        group.isTag
          ? "bg-amber-900/60 text-amber-200"
          : group.isHead
            ? ""
            : "bg-violet-900/60 text-violet-200"
      } ${!group.isTag && !group.isHead ? "cursor-pointer hover:brightness-125" : ""}`}
      style={
        group.isHead
          ? {
              // Same hue as the HEAD line in the graph. Text is pulled toward
              // the theme's foreground so it stays readable in light themes.
              color: `color-mix(in srgb, ${headColor} 70%, var(--color-neutral-100))`,
              backgroundColor: `color-mix(in srgb, ${headColor} 22%, transparent)`,
            }
          : undefined
      }
    >
      {isPending ? (
        <Loader2 size={11} className="shrink-0 animate-spin" />
      ) : (
        <>
          {group.isHead && <Check size={11} className="shrink-0" />}
          {group.isTag && <Tag size={11} className="shrink-0" />}
        </>
      )}
      <span className="truncate">{group.name}</span>
      {group.hasLocal && <Monitor size={11} className="shrink-0 opacity-70" />}
      {group.hasRemote && <Cloud size={11} className="shrink-0 opacity-70" />}
      {openMr && (
        <span title="Open merge request" className="inline-flex shrink-0">
          <GitMerge size={11} className="opacity-70" />
        </span>
      )}
      {menu}
    </span>
  );
}

function BranchCell({
  groups,
  repoId,
  targetSha,
  localBranchNames,
  currentBranch,
  width,
  gitlabInstance,
  openMrByBranch,
  onCreateMr,
  headColor,
  pinnedBranch,
  onTogglePin,
}: {
  groups: GroupedRef[];
  repoId: string;
  targetSha: string;
  localBranchNames: Set<string>;
  currentBranch: string | null;
  width: number;
  gitlabInstance: GitLabInstance | null;
  openMrByBranch: Map<string, MergeRequestInfo>;
  onCreateMr: (branchName: string) => void;
  headColor: string;
  pinnedBranch: string | null;
  onTogglePin: (branchName: string) => void;
}) {
  if (groups.length === 0) return <span className="shrink-0" style={{ width }} />;

  const primary = groups.find((g) => g.isHead) ?? groups[0];
  const extra = groups.filter((g) => g !== primary);

  return (
    // Right-aligned so the refs sit next to the graph / commit message.
    <span className="group/branchcell relative flex shrink-0 items-center justify-end px-1" style={{ width }}>
      <span className="flex min-w-0 items-center gap-1 overflow-hidden">
        <BranchPill
          group={primary}
          repoId={repoId}
          targetSha={targetSha}
          localBranchNames={localBranchNames}
          currentBranch={currentBranch}
          gitlabInstance={gitlabInstance}
          openMr={openMrByBranch.get(primary.name)}
          onCreateMr={onCreateMr}
          headColor={headColor}
          pinnedBranch={pinnedBranch}
          onTogglePin={onTogglePin}
        />
        {extra.length > 0 && (
          <span className="shrink-0 rounded bg-neutral-700 px-1 text-[10px] text-neutral-300">
            +{extra.length}
          </span>
        )}
      </span>
      {extra.length > 0 && (
        <span className="absolute right-1 top-0.5 z-10 hidden w-max min-w-[calc(100%-0.5rem)] flex-col items-end gap-1 rounded border border-neutral-700 bg-neutral-900 p-1 shadow-xl group-hover/branchcell:flex">
          <BranchPill
            group={primary}
            repoId={repoId}
            targetSha={targetSha}
            localBranchNames={localBranchNames}
            currentBranch={currentBranch}
            gitlabInstance={gitlabInstance}
            openMr={openMrByBranch.get(primary.name)}
            onCreateMr={onCreateMr}
            headColor={headColor}
            pinnedBranch={pinnedBranch}
            onTogglePin={onTogglePin}
          />
          {extra.map((g) => (
            <BranchPill
              key={g.name + g.isTag}
              group={g}
              repoId={repoId}
              targetSha={targetSha}
              localBranchNames={localBranchNames}
              currentBranch={currentBranch}
              gitlabInstance={gitlabInstance}
              openMr={openMrByBranch.get(g.name)}
              onCreateMr={onCreateMr}
              headColor={headColor}
              pinnedBranch={pinnedBranch}
              onTogglePin={onTogglePin}
            />
          ))}
        </span>
      )}
    </span>
  );
}

// ponytail: renders the whole loaded page directly (no @tanstack/react-virtual),
// fine up to a few thousand rows; add row virtualization if that stops being true.
export function CommitGraph({
  repoId,
  selection,
  currentBranch,
  hasLocalChanges,
  onSelectionChange,
}: {
  repoId: string;
  selection: GraphSelection;
  currentBranch: string | null;
  hasLocalChanges: boolean;
  onSelectionChange: (next: GraphSelection) => void;
}) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending } = useInfiniteQuery({
    queryKey: queryKeys.commitLog(repoId),
    queryFn: ({ pageParam }) => getCommitLog(repoId, pageParam, PAGE_SIZE),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextSkip ?? undefined,
  });
  const {
    localBranchNames,
    checkoutDetachedWithFeedback,
    cherryPickWithFeedback,
    cherryPickManyWithFeedback,
    resetToWithFeedback,
  } = useBranchActions(repoId);
  const { stashes, pop: stashPop, apply: stashApply, drop: stashDrop } = useStashActions(repoId);
  const { open: openCommitMenu, menu: commitMenu } = useContextMenu();
  const anyMutating = useIsMutating() > 0;

  const { instance: gitlabInstance, projectPath: gitlabProjectPath } = useGitLabRemote(repoId);
  const openMrByBranch = useOpenMergeRequests(repoId, gitlabInstance, gitlabProjectPath);
  const [createMrTarget, setCreateMrTarget] = useState<string | null>(null);
  const [createBranchAt, setCreateBranchAt] = useState<string | null>(null);

  const [branchColWidth, setBranchColWidth] = usePersistedNumber("graph.branchColWidth", 200);
  const [dateColWidth, setDateColWidth] = usePersistedNumber("graph.dateColWidth", 144);

  const commits = useMemo(() => data?.pages.flatMap((p) => p.commits) ?? [], [data]);
  const commitIndexBySha = useMemo(
    () => new Map(commits.map((c, i) => [c.sha, i] as const)),
    [commits],
  );
  const lastClickedShaRef = useRef<string | null>(null);

  const selectedShas = useMemo(() => {
    if (selection?.kind === "commit") return new Set([selection.commit.sha]);
    if (selection?.kind === "commits") return new Set(selection.commits.map((c) => c.sha));
    return new Set<string>();
  }, [selection]);

  const handleCommitClick = (e: MouseEvent, commit: CommitNode) => {
    const index = commitIndexBySha.get(commit.sha);
    if (index === undefined) return;

    if (e.shiftKey && lastClickedShaRef.current) {
      const lastIndex = commitIndexBySha.get(lastClickedShaRef.current);
      if (lastIndex !== undefined) {
        const [lo, hi] = [lastIndex, index].sort((a, b) => a - b);
        const range = commits.slice(lo, hi + 1);
        onSelectionChange({ kind: "commits", commits: range, fromSha: commits[hi].sha, toSha: commits[lo].sha });
        return;
      }
    }

    if (e.ctrlKey || e.metaKey) {
      const current =
        selection?.kind === "commits" ? selection.commits : selection?.kind === "commit" ? [selection.commit] : [];
      const exists = current.some((c) => c.sha === commit.sha);
      const next = exists ? current.filter((c) => c.sha !== commit.sha) : [...current, commit];
      lastClickedShaRef.current = commit.sha;
      if (next.length === 0) return onSelectionChange(null);
      if (next.length === 1) return onSelectionChange({ kind: "commit", commit: next[0] });
      const indices = next.map((c) => commitIndexBySha.get(c.sha) ?? 0);
      const minIdx = Math.min(...indices);
      const maxIdx = Math.max(...indices);
      return onSelectionChange({
        kind: "commits",
        commits: next,
        fromSha: commits[maxIdx].sha,
        toSha: commits[minIdx].sha,
      });
    }

    lastClickedShaRef.current = commit.sha;
    const isSameSingle = selection?.kind === "commit" && selection.commit.sha === commit.sha;
    onSelectionChange(isSameSingle ? null : { kind: "commit", commit });
  };

  const handleCommitContextMenu = (e: React.MouseEvent, commit: CommitNode) => {
    const multiSelected =
      selection?.kind === "commits" && selection.commits.some((c) => c.sha === commit.sha);

    if (multiSelected && selection?.kind === "commits") {
      const shas = selection.commits
        .map((c) => c.sha)
        .sort((a, b) => (commitIndexBySha.get(b) ?? 0) - (commitIndexBySha.get(a) ?? 0));
      openCommitMenu(e, [
        {
          label: `Cherry-pick ${shas.length} commits`,
          onClick: () => cherryPickManyWithFeedback(shas),
          disabled: anyMutating,
        },
      ]);
      return;
    }

    openCommitMenu(e, [
      {
        label: "Copy commit SHA",
        onClick: () => {
          writeText(commit.sha);
          toast.success("SHA copied");
        },
      },
      {
        label: "Create branch here",
        onClick: () => setCreateBranchAt(commit.sha),
        disabled: anyMutating,
      },
      {
        label: "Checkout this commit",
        onClick: () => checkoutDetachedWithFeedback(commit.sha),
        disabled: anyMutating,
      },
      {
        label: "Cherry-pick",
        onClick: async () => {
          const createCommit = await confirm(
            "Create a commit for the cherry-pick? Cancel brings only the changes for review (staged), without committing.",
            { title: "Cherry-pick", kind: "info" },
          );
          cherryPickWithFeedback({ sha: commit.sha, createCommit });
        },
        disabled: anyMutating,
      },
      ...(currentBranch
        ? [
            {
              label: `Reset ${currentBranch} to this commit`,
              submenu: [
                {
                  label: "Soft (keep changes staged)",
                  onClick: () => resetToWithFeedback({ sha: commit.sha, hard: false }),
                  disabled: anyMutating || hasLocalChanges,
                },
                {
                  label: "Hard (discard all changes)",
                  onClick: () => resetToWithFeedback({ sha: commit.sha, hard: true }),
                  disabled: anyMutating || hasLocalChanges,
                },
              ],
            },
          ]
        : []),
    ]);
  };

  const handleStashContextMenu = (e: React.MouseEvent, stash: StashInfo) => {
    openCommitMenu(e, [
      {
        label: "Apply",
        onClick: () => stashApply.mutate(stash.index),
        disabled: anyMutating,
      },
      {
        label: "Pop",
        onClick: () => stashPop.mutate(stash.index),
        disabled: anyMutating,
      },
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
  };

  const refs = data?.pages[0]?.refs ?? [];
  const headSha = refs.find((r) => r.isHead)?.targetSha;
  // ponytail: WIP only anchors to an attached HEAD (via the isHead ref); a
  // detached HEAD has no such ref, so the pseudo-row is skipped in that case.
  const showWip = hasLocalChanges && !!headSha;

  const entries = useMemo<GraphRowEntry[]>(() => {
    // Stashes are placed by when they were made: before the first commit
    // that isn't newer than them (so a fresh stash rises to the top) — but
    // never below their base commit, since a child row must sit above its
    // parent. Stashes come newest-first (stash@{0}), which keeps that order
    // among stashes landing on the same spot.
    // ponytail: stashes whose base commit isn't in the currently loaded page
    // simply don't show up in the graph yet — the branches sidebar still
    // lists every stash regardless, so nothing is actually hidden.
    const commitIndex = new Map(commits.map((c, i) => [c.sha, i]));
    const stashesAt = new Map<number, StashInfo[]>();
    for (const stash of stashes ?? []) {
      const baseIndex = commitIndex.get(stash.baseSha);
      if (baseIndex === undefined) continue;
      const byDate = commits.findIndex((c) => c.committerDate <= stash.date);
      const at = Math.min(byDate === -1 ? baseIndex : byDate, baseIndex);
      stashesAt.set(at, [...(stashesAt.get(at) ?? []), stash]);
    }
    const commitEntries: GraphRowEntry[] = commits.flatMap((commit, i) => [
      ...(stashesAt.get(i) ?? []).map((stash): GraphRowEntry => ({ kind: "stash", stash })),
      { kind: "commit", commit } as GraphRowEntry,
    ]);
    return showWip ? [{ kind: "wip" }, ...commitEntries] : commitEntries;
  }, [commits, showWip, stashes]);

  const laneInputs = useMemo<LaneInput[]>(
    () =>
      entries.map((entry) => {
        if (entry.kind === "wip") return { sha: "wip", parents: headSha ? [headSha] : [] };
        if (entry.kind === "stash") return { sha: entry.stash.sha, parents: [entry.stash.baseSha] };
        return { sha: entry.commit.sha, parents: entry.commit.parents };
      }),
    [entries, headSha],
  );
  // A branch pinned from its pill's context menu gets lane 0 (leftmost) for
  // its whole first-parent line; remembered per repo. Resolved by name so it
  // follows the branch as it moves — local branch first, else its remote.
  const [pinnedBranch, setPinnedBranch] = usePersistedValue<string | null>(`graph.pinnedBranch.${repoId}`, null);
  const togglePin = (name: string) => setPinnedBranch(pinnedBranch === name ? null : name);
  const pinnedLine = useMemo(() => {
    const line = new Set<string>();
    if (!pinnedBranch) return line;
    const local = refs.find((r) => r.kind === "LocalBranch" && r.name === pinnedBranch);
    const remote = refs.find(
      (r) => r.kind === "RemoteBranch" && r.name.slice(r.name.indexOf("/") + 1) === pinnedBranch,
    );
    const tip = (local ?? remote)?.targetSha;
    if (!tip) return line;
    const firstParent = new Map(laneInputs.map((l) => [l.sha, l.parents[0]]));
    // The WIP row sits on top of HEAD, so it joins the pinned line too.
    let cur: string | undefined = showWip && tip === headSha ? "wip" : tip;
    while (cur && firstParent.has(cur) && !line.has(cur)) {
      line.add(cur);
      cur = firstParent.get(cur);
    }
    return line;
  }, [pinnedBranch, refs, laneInputs, showWip, headSha]);
  const rows = useMemo(() => computeLanes(laneInputs, pinnedLine), [laneInputs, pinnedLine]);
  // The checked-out branch's "line": HEAD (or the WIP row above it) followed
  // down its first-parent chain, like `git log --first-parent`. Merged-in
  // side branches aren't part of it.
  const headColor = HEAD_COLOR;
  const { headLine, firstParent } = useMemo(() => {
    const firstParent = new Map(laneInputs.map((l) => [l.sha, l.parents[0]]));
    const headLine = new Set<string>();
    let cur = showWip ? "wip" : headSha;
    while (cur && firstParent.has(cur) && !headLine.has(cur)) {
      headLine.add(cur);
      cur = firstParent.get(cur);
    }
    return { headLine, firstParent };
  }, [laneInputs, showWip, headSha]);
  const refsBySha = useMemo(() => {
    const map = new Map<string, RefInfo[]>();
    for (const ref of refs) {
      const list = map.get(ref.targetSha) ?? [];
      list.push(ref);
      map.set(ref.targetSha, list);
    }
    return map;
  }, [refs]);

  const laneCount = rows.reduce((max, r) => Math.max(max, r.lane + 1), 1);
  const svgWidth = laneCount * LANE_WIDTH;

  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = scrollRef.current;
    const target = sentinelRef.current;
    if (!root || !target || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) fetchNextPage();
      },
      { root, rootMargin: "300px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, fetchNextPage]);

  if (isPending) return <p className="p-4 text-sm text-neutral-400">Loading commits...</p>;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-stretch border-b border-neutral-800 text-[11px] uppercase text-neutral-500">
        <span className="px-2 py-1" style={{ width: branchColWidth }}>
          Branch / Tag
        </span>
        <ResizeHandle onDrag={(dx) => setBranchColWidth((w) => Math.max(80, w + dx))} />
        <span className="py-1" style={{ width: svgWidth }} />
        <span className="flex-1 py-1">Commit message</span>
        <ResizeHandle onDrag={(dx) => setDateColWidth((w) => Math.max(80, w - dx))} />
        <span className="py-1 text-right" style={{ width: dateColWidth }}>
          Data
        </span>
        <span className="w-16 shrink-0 px-2 py-1 text-right">SHA</span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div className="relative" style={{ height: rows.length * ROW_HEIGHT }}>
          <svg
            width={svgWidth}
            height={rows.length * ROW_HEIGHT}
            className="absolute top-0"
            style={{ left: branchColWidth, overflow: "visible" }}
          >
            {rows.map((row, i) => {
              const y = i * ROW_HEIGHT + ROW_HEIGHT / 2;
              const x = row.lane * LANE_WIDTH + LANE_WIDTH / 2;
              const entry = entries[i];
              const nodeColor = PALETTE[row.color];
              return (
                <g key={row.sha}>
                  {row.parentConnections
                    .filter((c) => c.toRowIndex !== -1)
                    .map((c, ci) => {
                      const x2 = c.toLane * LANE_WIDTH + LANE_WIDTH / 2;
                      const y2 = c.toRowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
                      const sameLane = c.toLane === row.lane;
                      const onHeadLine =
                        headLine.has(row.sha) && rows[c.toRowIndex].sha === firstParent.get(row.sha);
                      // Hollow nodes (WIP, stashes) have no opaque fill to hide
                      // the line under — start it at the circle's edge instead
                      // of its center so it doesn't cut through the middle.
                      const isHollow = entry.kind === "wip" || entry.kind === "stash";

                      let d: string;
                      let color = PALETTE[row.color];
                      if (sameLane) {
                        const y1 = isHollow ? y + Math.sign(y2 - y || 1) * (AVATAR_SIZE / 2) : y;
                        d = `M ${x} ${y1} L ${x2} ${y2}`;
                      } else if (c.kind === "merge") {
                        // Merges bend at the merge commit's own row, colored
                        // like the branch being merged in.
                        const x1 = isHollow ? x + Math.sign(x2 - x || 1) * (AVATAR_SIZE / 2) : x;
                        d = elbowPath(x1, y, x2, y, x2, y2);
                        color = PALETTE[c.toLane % PALETTE.length];
                      } else {
                        // Direct branch points flow with time: exit the parent
                        // (older, below) sideways at its own row height, then
                        // run straight up into the child's lane, arriving at
                        // the child (newer, above) from underneath.
                        const yEnd = isHollow ? y + Math.sign(y2 - y || 1) * (AVATAR_SIZE / 2) : y;
                        d = elbowPath(x2, y2, x, y2, x, yEnd);
                      }

                      return (
                        <path
                          key={ci}
                          d={d}
                          fill="none"
                          style={{ stroke: color }}
                          strokeWidth={onHeadLine ? 2.25 : 2}
                        />
                      );
                    })}
                  {entry.kind === "wip" ? (
                    <circle
                      cx={x}
                      cy={y}
                      r={AVATAR_SIZE / 2}
                      fill="none"
                      style={{ stroke: nodeColor }}
                      strokeWidth={2}
                      strokeDasharray="3,2"
                    />
                  ) : entry.kind === "stash" ? (
                    <>
                      <circle
                        cx={x}
                        cy={y}
                        r={AVATAR_SIZE / 2}
                        fill="none"
                        stroke={PALETTE[row.color]}
                        strokeWidth={2}
                        strokeDasharray="3,2"
                      />
                      <Archive
                        x={x - AVATAR_SIZE / 2 + 2}
                        y={y - AVATAR_SIZE / 2 + 2}
                        width={AVATAR_SIZE - 4}
                        height={AVATAR_SIZE - 4}
                        color={PALETTE[row.color]}
                        strokeWidth={2}
                      />
                    </>
                  ) : (
                    <>
                      {/* Soft disc in the line's color behind the avatar — shows
                          as a faint ring around it, and through avatars with
                          transparent pixels. */}
                      <circle
                        cx={x}
                        cy={y}
                        r={AVATAR_SIZE / 2 + 4.5}
                        style={{ fill: nodeColor }}
                        fillOpacity={0.18}
                      />
                      <circle
                        cx={x}
                        cy={y}
                        r={AVATAR_SIZE / 2 + 1.5}
                        fill="none"
                        style={{ stroke: nodeColor }}
                        strokeWidth={2}
                      />
                      {/* Filling a circle with a pattern instead of clip-path on
                          the <image>: WebKitGTK doesn't honor
                          clipPathUnits="objectBoundingBox" on <image> elements,
                          which rendered the avatar as an unclipped square. */}
                      <defs>
                        <pattern id={`gk-avatar-${row.sha}`} patternUnits="objectBoundingBox" width={1} height={1}>
                          <image
                            href={gravatarUrl(entry.commit.authorEmail, 32)}
                            x={0}
                            y={0}
                            width={AVATAR_SIZE}
                            height={AVATAR_SIZE}
                            preserveAspectRatio="xMidYMid slice"
                          />
                        </pattern>
                      </defs>
                      <circle cx={x} cy={y} r={AVATAR_SIZE / 2} fill={`url(#gk-avatar-${row.sha})`} />
                    </>
                  )}
                  {entry.kind !== "wip" && (
                    <circle
                      cx={x}
                      cy={y}
                      r={AVATAR_SIZE / 2 + 2}
                      fill="transparent"
                      onContextMenu={(e) =>
                        entry.kind === "stash"
                          ? handleStashContextMenu(e, entry.stash)
                          : handleCommitContextMenu(e, entry.commit)
                      }
                    />
                  )}
                </g>
              );
            })}
          </svg>

          <ul className="select-none" onMouseDown={(e) => e.shiftKey && e.preventDefault()}>
            {entries.map((entry, i) => {
              if (entry.kind === "wip") {
                return (
                  <li
                    key="wip"
                    onClick={() => onSelectionChange(selection?.kind === "wip" ? null : { kind: "wip" })}
                    className={`flex cursor-pointer items-center gap-2 text-sm text-neutral-200 ${
                      selection?.kind === "wip" ? "bg-neutral-800" : "hover:bg-neutral-900"
                    }`}
                    style={{ height: ROW_HEIGHT }}
                  >
                    <span className="shrink-0" style={{ width: branchColWidth }} />
                    <span className="shrink-0" style={{ width: svgWidth }} />
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate italic text-neutral-400">
                      <Pencil size={12} className="shrink-0" /> Uncommitted changes
                    </span>
                    <span className="shrink-0" style={{ width: dateColWidth }} />
                    <span className="w-16 shrink-0 px-2" />
                  </li>
                );
              }

              if (entry.kind === "stash") {
                const stash = entry.stash;
                const isSelected = selection?.kind === "stash" && selection.stash.sha === stash.sha;
                return (
                  <li
                    key={stash.sha}
                    onClick={() =>
                      onSelectionChange(isSelected ? null : { kind: "stash", stash })
                    }
                    onContextMenu={(e) => handleStashContextMenu(e, stash)}
                    className={`flex cursor-pointer items-center gap-2 text-sm text-neutral-200 ${
                      isSelected ? "bg-neutral-800" : "hover:bg-neutral-900"
                    }`}
                    style={{ height: ROW_HEIGHT }}
                  >
                    <span className="shrink-0" style={{ width: branchColWidth }} />
                    <span className="shrink-0" style={{ width: svgWidth }} />
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate italic text-neutral-400">
                      <Archive size={12} className="shrink-0" /> {stash.message}
                    </span>
                    <span className="shrink-0 text-right text-xs text-neutral-500" style={{ width: dateColWidth }}>
                      {new Date(stash.date * 1000).toLocaleString()}
                    </span>
                    <span className="w-16 shrink-0 px-2 text-right font-mono text-xs text-neutral-500">
                      {stash.sha.slice(0, 7)}
                    </span>
                  </li>
                );
              }

              const commit = entry.commit;
              const groups = groupRefs(refsBySha.get(commit.sha) ?? []);
              const laneColor = PALETTE[rows[i].color];
              const bandStart = branchColWidth + rows[i].lane * LANE_WIDTH + LANE_WIDTH / 2;
              return (
                <li
                  key={commit.sha}
                  onClick={(e) => handleCommitClick(e, commit)}
                  onContextMenu={(e) => handleCommitContextMenu(e, commit)}
                  className={`flex cursor-pointer items-center gap-2 text-sm text-neutral-200 ${
                    selectedShas.has(commit.sha) ? "bg-neutral-800" : "hover:bg-neutral-900"
                  }`}
                  style={{
                    height: ROW_HEIGHT,
                    // Lane-colored band from the node to the row's right edge.
                    backgroundImage: `linear-gradient(to right, transparent ${bandStart}px, color-mix(in srgb, ${laneColor} 12%, transparent) ${bandStart}px)`,
                  }}
                >
                  <BranchCell
                    groups={groups}
                    repoId={repoId}
                    targetSha={commit.sha}
                    localBranchNames={localBranchNames}
                    currentBranch={currentBranch}
                    width={branchColWidth}
                    gitlabInstance={gitlabInstance}
                    openMrByBranch={openMrByBranch}
                    onCreateMr={setCreateMrTarget}
                    headColor={headColor}
                    pinnedBranch={pinnedBranch}
                    onTogglePin={togglePin}
                  />
                  <span className="shrink-0" style={{ width: svgWidth }} />
                  <span className="min-w-0 flex-1 truncate">{commit.summary}</span>
                  <span
                    className="shrink-0 text-right text-xs text-neutral-500"
                    style={{ width: dateColWidth }}
                  >
                    {new Date(commit.authorDate * 1000).toLocaleString()}
                  </span>
                  <span className="w-16 shrink-0 px-2 text-right font-mono text-xs text-neutral-500">
                    {commit.shortSha}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        {hasNextPage && <div ref={sentinelRef} className="h-px" />}
        {isFetchingNextPage && (
          <p className="py-2 text-center text-xs text-neutral-500">Loading more...</p>
        )}
      </div>
      {commitMenu}
      {createBranchAt && (
        <CreateBranchModal repoId={repoId} startSha={createBranchAt} onClose={() => setCreateBranchAt(null)} />
      )}
      {createMrTarget && currentBranch && gitlabInstance && gitlabProjectPath && (
        <CreateMergeRequestModal
          repoId={repoId}
          instance={gitlabInstance}
          projectPath={gitlabProjectPath}
          sourceBranch={currentBranch}
          initialTargetBranch={createMrTarget}
          onClose={() => setCreateMrTarget(null)}
        />
      )}
    </div>
  );
}
