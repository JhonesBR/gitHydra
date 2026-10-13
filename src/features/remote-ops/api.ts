import { call } from "@/lib/tauri-client";
import type { FetchSummary, PushSummary } from "./types";

export const fetchRemote = (repoId: string, remoteName: string) =>
  call<FetchSummary>("fetch_remote", { repoId, remoteName });

export const pushBranch = (repoId: string, remoteName: string, branch: string, force: boolean) =>
  call<PushSummary>("push_branch", { repoId, remoteName, branch, force });

export const getRemoteUrl = (repoId: string, remoteName: string) =>
  call<string | null>("get_remote_url", { repoId, remoteName });
