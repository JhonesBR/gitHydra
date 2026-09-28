import type { RepoStatus } from "@/features/repository/api";
import { call } from "@/lib/tauri-client";
import type { BranchInfo, CherryPickResult } from "./types";

export const listBranches = (repoId: string) =>
  call<BranchInfo[]>("list_branches", { repoId });

export const createBranch = (
  repoId: string,
  name: string,
  startPoint: string | null,
  checkout: boolean,
) => call<BranchInfo>("create_branch", { repoId, name, startPoint, checkout });

export const checkoutBranch = (repoId: string, name: string) =>
  call<void>("checkout_branch", { repoId, name });

export const checkoutAt = (
  repoId: string,
  name: string,
  targetSha: string,
  remoteName: string | null,
) => call<void>("checkout_at", { repoId, name, targetSha, remoteName });

export const checkoutCommitDetached = (repoId: string, sha: string) =>
  call<void>("checkout_commit_detached", { repoId, sha });

export const cherryPick = (repoId: string, sha: string, createCommit: boolean) =>
  call<CherryPickResult>("cherry_pick", { repoId, sha, createCommit });

export const resetToCommit = (repoId: string, sha: string, hard: boolean) =>
  call<RepoStatus>("reset_to_commit", { repoId, sha, hard });
