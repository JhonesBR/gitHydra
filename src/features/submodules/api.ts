import { call } from "@/lib/tauri-client";

export type SubmoduleState = "uninitialized" | "outOfDate" | "dirty" | "upToDate";

export type SubmoduleInfo = {
  name: string;
  /** Relative to the superproject. */
  path: string;
  absPath: string;
  url: string | null;
  /** Commit the superproject records. */
  expectedSha: string | null;
  /** Commit checked out inside it. */
  currentSha: string | null;
  initialized: boolean;
  state: SubmoduleState;
};

export const submodulesKey = (repoId: string) => ["submodules", repoId] as const;

export const listSubmodules = (repoId: string) => call<SubmoduleInfo[]>("list_submodules", { repoId });

/** `git submodule update --init`; every submodule when `paths` is empty. */
export const updateSubmodules = (repoId: string, paths: string[]) =>
  call<SubmoduleInfo[]>("update_submodules", { repoId, paths });
