import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { FileDiff, FileStatus } from "@/features/diff-viewer/types";
import { useProfiles } from "@/features/profiles/useProfiles";
import { confirm } from "@/lib/confirm-store";
import { queryKeys } from "@/lib/query-keys";
import { errorMessage } from "@/lib/tauri-client";
import {
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
import type { FileEntry } from "./types";

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

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between bg-neutral-950 px-3 py-1.5 text-xs uppercase text-neutral-500">
        <span>{title}</span>
        {action}
      </div>
      <ul>{children}</ul>
    </div>
  );
}

export function StagingPanel({
  repoId,
  selectedFilePath,
  onOpenFile,
}: {
  repoId: string;
  selectedFilePath: string | null;
  onOpenFile: (file: FileDiff | null) => void;
}) {
  const queryClient = useQueryClient();
  const { activeProfile } = useProfiles();
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");

  const { data: status } = useQuery({
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
  ) => {
    if (selectedFilePath !== path) return;
    const idx = (list ?? []).findIndex((f) => f.path === path);
    const next = idx !== -1 ? list?.[idx + 1] : undefined;
    const nextFile = next && diff?.files.find((f) => f.path === next.path);
    onOpenFile(nextFile ?? null);
  };

  const stagePathMut = useMutation({
    mutationFn: (path: string) => stagePath(repoId, path),
    onSuccess: (_data, path) => {
      invalidate();
      advanceAfterAction(status?.unstaged, unstagedDiff, path);
    },
    onError,
  });
  const stageAllMut = useMutation({ mutationFn: () => stageAll(repoId), onSuccess: invalidate, onError });
  const unstagePathMut = useMutation({
    mutationFn: (path: string) => unstagePath(repoId, path),
    onSuccess: (_data, path) => {
      invalidate();
      advanceAfterAction(status?.staged, stagedDiff, path);
    },
    onError,
  });
  const unstageAllMut = useMutation({ mutationFn: () => unstageAll(repoId), onSuccess: invalidate, onError });
  const discardPathMut = useMutation({ mutationFn: (path: string) => discardPath(repoId, path), onSuccess: invalidate, onError });
  const discardAllMut = useMutation({ mutationFn: () => discardAll(repoId), onSuccess: invalidate, onError });

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
      ),
    onSuccess: () => {
      setSummary("");
      setDescription("");
      queryClient.invalidateQueries({ queryKey: queryKeys.commitLog(repoId) });
      invalidate();
      toast.success("Commit created");
    },
    onError,
  });

  const openFile = (diff: typeof unstagedDiff, path: string) => {
    const file = diff?.files.find((f) => f.path === path);
    if (file) onOpenFile(file);
  };

  const renderFile = (
    file: FileEntry,
    diff: typeof unstagedDiff,
    onAction: () => void,
    actionLabel: string,
    pending: boolean,
    discard?: { onDiscard: () => void; pending: boolean },
  ) => (
    <li
      key={file.path}
      onClick={() => openFile(diff, file.path)}
      className={`group flex cursor-pointer items-center gap-2 px-3 py-1 ${
        selectedFilePath === file.path ? "bg-neutral-800" : "hover:bg-neutral-900"
      }`}
    >
      <span className="w-4 shrink-0 text-center font-mono text-xs text-neutral-500">
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

  return (
    <div className="flex h-full flex-col overflow-hidden text-sm">
      <div className="flex-1 overflow-auto">
        <Section
          title={`${status?.unstaged.length ?? 0} uncommitted`}
          action={
            <span className="flex items-center gap-1">
              <button
                onClick={confirmDiscardAll}
                disabled={!status?.unstaged.length || discardAllMut.isPending}
                className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-900/60 disabled:opacity-40"
              >
                {discardAllMut.isPending && <Loader2 size={9} className="mr-1 inline animate-spin" />}
                discard all
              </button>
              <button
                onClick={() => stageAllMut.mutate()}
                disabled={!status?.unstaged.length || stageAllMut.isPending}
                className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] hover:bg-neutral-700 disabled:opacity-40"
              >
                stage all
              </button>
            </span>
          }
        >
          {status?.unstaged.map((f) =>
            renderFile(
              f,
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
          title={`${status?.staged.length ?? 0} staged`}
          action={
            <button
              onClick={() => unstageAllMut.mutate()}
              disabled={!status?.staged.length || unstageAllMut.isPending}
              className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] hover:bg-neutral-700 disabled:opacity-40"
            >
              unstage all
            </button>
          }
        >
          {status?.staged.map((f) =>
            renderFile(
              f,
              stagedDiff,
              () => unstagePathMut.mutate(f.path),
              "unstage",
              unstagePathMut.isPending && unstagePathMut.variables === f.path,
            ),
          )}
        </Section>
      </div>

      <div className="shrink-0 space-y-2 border-t border-neutral-800 p-2">
        <input
          value={summary}
          onChange={(e) => setSummary(e.currentTarget.value)}
          placeholder="Commit message"
          className="w-full rounded bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          placeholder="Description (optional)"
          rows={3}
          className="w-full resize-none rounded bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
        />
        <button
          onClick={() => commitMut.mutate()}
          disabled={!summary.trim() || !status?.staged.length || commitMut.isPending}
          className="flex w-full items-center justify-center gap-1.5 rounded bg-emerald-800 px-2 py-1.5 text-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          {commitMut.isPending && <Loader2 size={13} className="animate-spin" />} Commit
        </button>
      </div>
    </div>
  );
}
