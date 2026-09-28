import { call } from "@/lib/tauri-client";
import type { WorkspaceRepoEntry } from "./types";

export const scanWorkspace = (path: string) =>
  call<WorkspaceRepoEntry[]>("scan_workspace", { path });

export const fetchRepoAtPath = (path: string) => call<void>("fetch_repo_at_path", { path });
