import { call } from "@/lib/tauri-client";
import type { FetchSummary, PushSummary } from "./types";

/** `background`: not asked for by the user, so it won't prompt for an SSH key passphrase. */
export const fetchRemote = (repoId: string, remoteName: string, opts?: { background?: boolean }) =>
  call<FetchSummary>("fetch_remote", { repoId, remoteName, background: opts?.background ?? false });

export const pushBranch = (repoId: string, remoteName: string, branch: string, force: boolean) =>
  call<PushSummary>("push_branch", { repoId, remoteName, branch, force });

export const getRemoteUrl = (repoId: string, remoteName: string) =>
  call<string | null>("get_remote_url", { repoId, remoteName });
