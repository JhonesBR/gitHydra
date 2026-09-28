import { call } from "@/lib/tauri-client";
import type { CommitLogPage } from "./types";

export const getCommitLog = (repoId: string, skip: number, limit: number) =>
  call<CommitLogPage>("get_commit_log", {
    repoId,
    query: { skip, limit, branchFilter: null },
  });
