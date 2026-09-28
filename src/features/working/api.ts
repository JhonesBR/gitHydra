import type { CommitDiff } from "@/features/diff-viewer/types";
import { call } from "@/lib/tauri-client";
import type { WorkingStatus } from "./types";

export const getWorkingStatus = (repoId: string) =>
  call<WorkingStatus>("get_working_status", { repoId });

export const stagePath = (repoId: string, path: string) => call<void>("stage_path", { repoId, path });

export const stageAll = (repoId: string) => call<void>("stage_all", { repoId });

export const unstagePath = (repoId: string, path: string) =>
  call<void>("unstage_path", { repoId, path });

export const unstageAll = (repoId: string) => call<void>("unstage_all", { repoId });

export const discardPath = (repoId: string, path: string) =>
  call<void>("discard_path", { repoId, path });

export const discardAll = (repoId: string) => call<void>("discard_all", { repoId });

export const getWorkdirDiff = (repoId: string, staged: boolean) =>
  call<CommitDiff>("get_workdir_diff", { repoId, staged });

export const commitChanges = (
  repoId: string,
  summary: string,
  body: string,
  authorName: string | null,
  authorEmail: string | null,
) => call<string>("commit_changes", { repoId, summary, body, authorName, authorEmail });
