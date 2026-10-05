import { call } from "@/lib/tauri-client";
import type { CommitLogPage, CommitNode } from "./types";

export const getCommitLog = (repoId: string, skip: number, limit: number) =>
  call<CommitLogPage>("get_commit_log", {
    repoId,
    query: { skip, limit, branchFilter: null },
  });

export const getHeadCommit = (repoId: string) =>
  call<CommitNode | null>("get_head_commit", { repoId });
