import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronDown, Loader2, Search, Wand2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Popover } from "@/components/Popover";
import { useContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { generateCommitMessage } from "@/features/ai/api";
import { PROVIDER_LABELS } from "@/features/ai/models";
import { useAiSettings } from "@/features/ai/useAiSettings";
import type { CommitNode } from "@/features/commit-graph/types";
import type { FileDiff, FileStatus } from "@/features/diff-viewer/types";
import { fileHistoryMenuItems } from "@/features/history/store";
import { useProfiles } from "@/features/profiles/useProfiles";
import { confirm } from "@/lib/confirm-store";
import { queryKeys } from "@/lib/query-keys";
import { errorMessage } from "@/lib/tauri-client";
import {
  addIgnorePattern,
  commitChanges,
  discardAll,
  discardPath,
  getWorkdirDiff,
  getWorkingStatus,
  stageAll,
  stagePath,
  unstageAll,
  unstagePath,
} from "./api";
import { toastCommitError } from "./commit-error";
import { ComposeCommitsModal } from "./ComposeCommitsModal";
import { filterFiles } from "./filterFiles";
import { ignoreOptions } from "./ignorePatterns";
import type { FileEntry, WorkingSide } from "./types";

function statusLabel(status: FileStatus): string {
  switch (status) {
    case "Added":
      return "A";
    case "Deleted":
      return "D";
    case "Renamed":
      return "R";
    case "Copied":
      return "C";
    case "TypeChange":
      return "T";
    case "Modified":
      return "M";
    default:
      return "?";
  }
}

function statusColor(status: FileStatus): string {
  switch (status) {
    case "Added":
      return "text-emerald-400";
    case "Deleted":
      return "text-red-400";
    case "Modified":
      return "text-amber-400";
    default:
      return "text-neutral-500";
  }
}

function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col overflow-hidden ${className ?? ""}`}>
      <div className="flex shrink-0 items-center justify-between bg-neutral-950 px-3 py-1.5 text-xs uppercase text-neutral-500">
        <span>{title}</span>
        {action}
      </div>
      <ul className="flex-1 overflow-auto">{children}</ul>
    </div>
  );
}

export function StagingPanel({
  repoId,
  selectedFilePath,
  selectedSide,
  onOpenFile,
  headCommit,
}: {
  repoId: string;
  selectedFilePath: string | null;
  /** Which list the open file came from (a file can be in both). */
  selectedSide: WorkingSide | null;
  onOpenFile: (file: FileDiff | null, side?: WorkingSide) => void;
  headCommit: CommitNode | null;
}) {
  const queryClient = useQueryClient();
  const { activeProfile } = useProfiles();
  const { settings } = useAiSettings();
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [amend, setAmend] = useState(false);
  // Per commit, like `git commit --no-verify`: resets after each commit.
  const [noVerify, setNoVerify] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [fileFilter, setFileFilter] = useState("");

  useEffect(() => {
    if (!amend || !headCommit) return;
    setSummary(headCommit.summary);
    setDescription(headCommit.body);
  }, [amend, headCommit]);

  const { data: status, isPending: statusPending } = useQuery({
    queryKey: queryKeys.workingStatus(repoId),
    queryFn: () => getWorkingStatus(repoId),
  });
  const { data: unstagedDiff } = useQuery({
    queryKey: queryKeys.workdirDiff(repoId, false),
    queryFn: () => getWorkdirDiff(repoId, false),
    enabled: (status?.unstaged.length ?? 0) > 0,
  });
  const { data: stagedDiff } = useQuery({
    queryKey: queryKeys.workdirDiff(repoId, true),
    queryFn: () => getWorkdirDiff(repoId, true),
    enabled: (status?.staged.length ?? 0) > 0,
  });

  // Keeps the open diff in sync with content that changed out from under it
  // (e.g. a stash pop/apply touching the currently viewed file, or some of
  // its lines being staged) instead of leaving the viewer pointed at a stale
  // patch until the file is reselected. Follows the file to the other list
  // when it has nothing left on its own side, and closes it when it has no
  // changes left at all.
  useEffect(() => {
    if (!selectedFilePath || !status) return;
    const inList = (side: WorkingSide) =>
      (side === "staged" ? status.staged : status.unstaged).some((f) => f.path === selectedFilePath);
    const preferred = selectedSide ?? "unstaged";
    const other = preferred === "staged" ? "unstaged" : "staged";
    const side = inList(preferred) ? preferred : inList(other) ? other : null;
    if (!side) {
      onOpenFile(null);
      return;
    }
    const file = (side === "staged" ? stagedDiff : unstagedDiff)?.files.find((f) => f.path === selectedFilePath);
    if (file) onOpenFile(file, side);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, unstagedDiff, stagedDiff]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.workingStatus(repoId) });
    queryClient.invalidateQueries({ queryKey: ["workdirDiff", repoId] });
    queryClient.invalidateQueries({ queryKey: queryKeys.repoStatus(repoId) });
  };

  const onError = (e: unknown) => toast.error(errorMessage(e));

  // If the file being staged/unstaged is the one currently open in the diff
  // viewer, advance to the next file in that same section instead of leaving
  // the viewer pointed at a file that just moved to the other list.
  const advanceAfterAction = (
    list: FileEntry[] | undefined,
    diff: typeof unstagedDiff,
    path: string,
    side: WorkingSide,
  ) => {
    if (selectedFilePath !== path) return;
    const idx = (list ?? []).findIndex((f) => f.path === path);
    const next = idx !== -1 ? list?.[idx + 1] : undefined;
    const nextFile = next && diff?.files.find((f) => f.path === next.path);
    onOpenFile(nextFile ?? null, side);
  };

  const stagePathMut = useMutation({
    mutationFn: (path: string) => stagePath(repoId, path),
    onSuccess: (_data, path) => {
      invalidate();
      advanceAfterAction(status?.unstaged, unstagedDiff, path, "unstaged");
    },
    onError,
  });
  const stageAllMut = useMutation({ mutationFn: () => stageAll(repoId), onSuccess: invalidate, onError });
  const unstagePathMut = useMutation({
    mutationFn: (path: string) => unstagePath(repoId, path),
    onSuccess: (_data, path) => {
      invalidate();
      advanceAfterAction(status?.staged, stagedDiff, path, "staged");
    },
    onError,
  });
  const unstageAllMut = useMutation({ mutationFn: () => unstageAll(repoId), onSuccess: invalidate, onError });
  const discardPathMut = useMutation({ mutationFn: (path: string) => discardPath(repoId, path), onSuccess: invalidate, onError });
  const discardAllMut = useMutation({ mutationFn: () => discardAll(repoId), onSuccess: invalidate, onError });
  const ignoreMut = useMutation({
    mutationFn: ({ pattern, local }: { pattern: string; local: boolean }) =>
      addIgnorePattern(repoId, pattern, local),
    onSuccess: (added, { pattern, local }) => {
      invalidate();
      const target = local ? ".git/info/exclude" : ".gitignore";
      if (added) toast.success(`Added "${pattern}" to ${target}`);
      else toast.info(`"${pattern}" is already in ${target}`);
    },
    onError,
  });

  const { open: openMenu, menu } = useContextMenu();
  const ignoreMenu = (path: string): ContextMenuItem[] => {
    const options = ignoreOptions(path);
    const item = (local: boolean) => (o: { label: string; pattern: string }) => ({
      label: o.label,
      onClick: () => ignoreMut.mutate({ pattern: o.pattern, local }),
    });
    return [
      ...options.map(item(false)),
      { label: "Ignore locally (this clone only)", submenu: options.map(item(true)) },
    ];
  };

  // Ignoring only affects untracked files (an unstaged "Added" entry): git
  // keeps tracking anything already in the index or HEAD. A brand-new file
  // has no history at HEAD yet.
  const fileMenuItems = (file: { path: string; status: FileStatus }, side: WorkingSide): ContextMenuItem[] => {
    if (file.status === "Added") return side === "unstaged" ? ignoreMenu(file.path) : [];
    if (file.status === "Other") return [];
    return fileHistoryMenuItems(repoId, file.path, null);
  };

  const confirmDiscard = async (path: string) => {
    const confirmed = await confirm(
      `Discard changes in "${path}"? This action cannot be undone.`,
      { title: "Discard changes", kind: "warning" },
    );
    if (confirmed) discardPathMut.mutate(path);
  };
  const confirmDiscardAll = async () => {
    const confirmed = await confirm(
      "Discard all uncommitted changes? This action cannot be undone.",
      { title: "Discard all changes", kind: "warning" },
    );
    if (confirmed) discardAllMut.mutate();
  };
  const commitMut = useMutation({
    mutationFn: () =>
      commitChanges(
        repoId,
        summary.trim(),
        description.trim(),
        activeProfile?.name || null,
        activeProfile?.email || null,
        amend,
        noVerify,
      ),
    onSuccess: () => {
      setSummary("");
      setDescription("");
      setAmend(false);
      setNoVerify(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.commitLog(repoId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.headCommit(repoId) });
      invalidate();
      toast.success(amend ? "Commit amended" : "Commit created");
    },
    onError: (e) => {
      toastCommitError(e);
      invalidate(); // a failed pre-commit may still have touched files (lint-staged fixes)
    },
  });

  const generateMessageMut = useMutation({
    mutationFn: () =>
      generateCommitMessage({
        provider: settings.provider,
        apiKey: settings.apiKeys[settings.provider],
        model: settings.commitMessageModel,
        diff: (stagedDiff?.files ?? []).map((f) => f.patch).join("\n"),
        customInstructions: settings.commitMessageCustomInstructions,
      }),
    onSuccess: (result) => {
      setSummary(result.summary);
      setDescription(result.description);
    },
    onError,
  });

  const generateCommitMessageClick = () => {
    if (!settings.apiKeys[settings.provider]) {
      toast.error(`Set an API key for ${PROVIDER_LABELS[settings.provider]} in AI Integration settings`);
      return;
    }
    generateMessageMut.mutate();
  };

  const openFile = (diff: typeof unstagedDiff, path: string, side: WorkingSide) => {
    const file = diff?.files.find((f) => f.path === path);
    if (file) onOpenFile(file, side);
  };

  const renderFile = (
    file: FileEntry,
    side: WorkingSide,
    diff: typeof unstagedDiff,
    onAction: () => void,
    actionLabel: string,
    pending: boolean,
    discard?: { onDiscard: () => void; pending: boolean },
  ) => (
    <li
      key={file.path}
      onClick={() => openFile(diff, file.path, side)}
      onContextMenu={(e) => {
        const items = fileMenuItems(file, side);
        if (items.length) openMenu(e, items);
      }}
      className={`group flex cursor-pointer items-center gap-2 px-3 py-1 ${
        selectedFilePath === file.path && (selectedSide ?? side) === side
          ? "bg-neutral-800"
          : "hover:bg-neutral-900"
      }`}
    >
      <span className={`w-4 shrink-0 text-center font-mono text-xs ${statusColor(file.status)}`}>
        {statusLabel(file.status)}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-neutral-300">{file.path}</span>
      <span
        className={`shrink-0 items-center gap-1 group-hover:flex ${
          pending || discard?.pending ? "flex" : "hidden"
        }`}
      >
        {discard && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              discard.onDiscard();
            }}
            disabled={discard.pending}
            title="Discard changes"
            className="flex shrink-0 items-center gap-1 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-900/60 disabled:opacity-50"
          >
            {discard.pending && <Loader2 size={9} className="animate-spin" />} discard
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAction();
          }}
          disabled={pending}
          className="flex shrink-0 items-center gap-1 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] hover:bg-neutral-700 disabled:opacity-50"
        >
          {pending && <Loader2 size={9} className="animate-spin" />} {actionLabel}
        </button>
      </span>
    </li>
  );

  const unstagedShown = filterFiles(status?.unstaged ?? [], fileFilter);
  const stagedShown = filterFiles(status?.staged ?? [], fileFilter);
  const countTitle = (shown: number, total: number, label: string) =>
    fileFilter.trim() ? `${shown}/${total} ${label}` : `${total} ${label}`;

  return (
    <div className="flex h-full flex-col overflow-hidden text-sm">
      <div className="flex flex-1 flex-col overflow-hidden">
        <label className="mx-2 mt-2 flex shrink-0 items-center gap-1.5 rounded bg-neutral-900 px-2 py-1 text-neutral-500">
          <Search size={12} className="shrink-0" />
          <input
            value={fileFilter}
            onChange={(e) => setFileFilter(e.currentTarget.value)}
            placeholder="Filter files"
            className="min-w-0 flex-1 bg-transparent text-xs text-neutral-200 outline-none placeholder:text-neutral-500"
          />
        </label>
        {statusPending && <p className="shrink-0 px-3 py-1 text-neutral-500">Loading...</p>}
        <Section
          className="flex-1 basis-0 border-b border-neutral-800"
          title={countTitle(unstagedShown.length, status?.unstaged.length ?? 0, "uncommitted")}
          action={
            <span className="flex items-center gap-1">
              <button
                onClick={confirmDiscardAll}
                disabled={!status?.unstaged.length || discardAllMut.isPending}
                className="rounded bg-red-900/60 px-1.5 py-0.5 text-[10px] text-red-200 hover:bg-red-900 disabled:opacity-40"
              >
                {discardAllMut.isPending && <Loader2 size={9} className="mr-1 inline animate-spin" />}
                discard all
              </button>
              <button
                onClick={() => stageAllMut.mutate()}
                disabled={!status?.unstaged.length || stageAllMut.isPending}
                className="rounded bg-emerald-900/60 px-1.5 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-900 disabled:opacity-40"
              >
                stage all
              </button>
            </span>
          }
        >
          {unstagedShown.map((f) =>
            renderFile(
              f,
              "unstaged",
              unstagedDiff,
              () => stagePathMut.mutate(f.path),
              "stage",
              stagePathMut.isPending && stagePathMut.variables === f.path,
              {
                onDiscard: () => confirmDiscard(f.path),
                pending: discardPathMut.isPending && discardPathMut.variables === f.path,
              },
            ),
          )}
        </Section>

        <Section
          className="flex-1 basis-0"
          title={countTitle(stagedShown.length, status?.staged.length ?? 0, "staged")}
          action={
            <button
              onClick={() => unstageAllMut.mutate()}
              disabled={!status?.staged.length || unstageAllMut.isPending}
              className="rounded bg-red-900/60 px-1.5 py-0.5 text-[10px] text-red-200 hover:bg-red-900 disabled:opacity-40"
            >
              unstage all
            </button>
          }
        >
          {stagedShown.map((f) =>
            renderFile(
              f,
              "staged",
              stagedDiff,
              () => unstagePathMut.mutate(f.path),
              "unstage",
              unstagePathMut.isPending && unstagePathMut.variables === f.path,
            ),
          )}
        </Section>
      </div>

      <div className="shrink-0 space-y-2 border-t border-neutral-800 p-2">
        <div className="flex items-center justify-between gap-2">
          <label className="mr-auto flex items-center gap-1.5 text-xs text-neutral-400">
            <input
              type="checkbox"
              checked={amend}
              disabled={!headCommit}
              onChange={(e) => setAmend(e.currentTarget.checked)}
              className="h-3 w-3 shrink-0 appearance-none rounded-sm border border-neutral-600 bg-neutral-900 checked:border-emerald-600 checked:bg-emerald-600"
            />
            Amend commit
          </label>
          <button
            onClick={() => {
              if (!settings.apiKeys[settings.provider]) {
                toast.error(`Set an API key for ${PROVIDER_LABELS[settings.provider]} in AI Integration settings`);
                return;
              }
              setComposeOpen(true);
            }}
            disabled={!status?.staged.length || amend}
            title="Split the staged files into atomic commits with AI"
            className="flex items-center gap-1 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-50"
          >
            <Wand2 size={12} /> Compose commits with AI
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            value={summary}
            onChange={(e) => setSummary(e.currentTarget.value)}
            placeholder="Commit message"
            className="w-full rounded bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
          />
          <button
            onClick={generateCommitMessageClick}
            disabled={!status?.staged.length || generateMessageMut.isPending}
            title="Generate commit message with AI"
            className="flex shrink-0 items-center justify-center rounded bg-neutral-800 p-1.5 text-neutral-300 hover:bg-neutral-700 disabled:opacity-50"
          >
            {generateMessageMut.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Bot size={14} />
            )}
          </button>
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          placeholder="Description (optional)"
          rows={3}
          className="w-full resize-none rounded bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
        />
        <div className="flex items-stretch gap-px">
          <button
            onClick={() => commitMut.mutate()}
            disabled={!summary.trim() || (!amend && !status?.staged.length) || commitMut.isPending}
            className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-l bg-emerald-800 px-2 py-1.5 text-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            {commitMut.isPending && <Loader2 size={13} className="animate-spin" />}{" "}
            {amend ? "Amend Commit" : "Commit"}
          </button>
          <Popover
            up
            trigger={(p) => (
              <button
                {...p}
                title="Commit options"
                className="flex h-full items-center rounded-r bg-emerald-800 px-1.5 hover:bg-emerald-700"
              >
                <ChevronDown size={14} />
              </button>
            )}
          >
            <label
              className="flex items-center gap-1.5 text-xs text-neutral-300"
              title="Like git commit --no-verify: don't run the pre-commit and commit-msg hooks for this commit"
            >
              <input
                type="checkbox"
                checked={noVerify}
                onChange={(e) => setNoVerify(e.currentTarget.checked)}
                className="h-3 w-3 shrink-0 appearance-none rounded-sm border border-neutral-600 bg-neutral-900 checked:border-amber-600 checked:bg-amber-600"
              />
              Skip hooks
            </label>
          </Popover>
        </div>
      </div>
      {menu}
      {composeOpen && (
        <ComposeCommitsModal
          repoId={repoId}
          fileCount={status?.staged.length ?? 0}
          author={activeProfile ? { name: activeProfile.name, email: activeProfile.email } : null}
          noVerify={noVerify}
          onApplied={() => setNoVerify(false)}
          onClose={() => setComposeOpen(false)}
        />
      )}
    </div>
  );
}
