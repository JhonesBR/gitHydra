import { call } from "@/lib/tauri-client";
import type { WorkspaceRepoEntry } from "./types";

export const scanWorkspace = (path: string) =>
  call<WorkspaceRepoEntry[]>("scan_workspace", { path });

/** `background` as in `fetchRemote`. */
export const fetchRepoAtPath = (path: string, opts?: { background?: boolean }) =>
  call<void>("fetch_repo_at_path", { path, background: opts?.background ?? false });
