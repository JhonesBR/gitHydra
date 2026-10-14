import { call } from "@/lib/tauri-client";
import type { AiProvider } from "./types";

export type CommitMessageResult = {
  summary: string;
  description: string;
};

export function generateCommitMessage(args: {
  provider: AiProvider;
  apiKey: string;
  model: string;
  diff: string;
  customInstructions: string;
}): Promise<CommitMessageResult> {
  return call<CommitMessageResult>("ai_generate_commit_message", args);
}

/** `changes` are staged-change ids: `path#N` (one hunk) or `path` (whole file). */
export type ComposedCommit = { summary: string; description: string; changes: string[] };

/** Either a commit plan, or (when the model needs clarification) questions. */
export type ComposeResult = { commits: ComposedCommit[]; questions: string[]; treeId: string };

export function composeCommits(args: {
  repoId: string;
  provider: AiProvider;
  apiKey: string;
  model: string;
  customInstructions: string;
  answers: string;
}): Promise<ComposeResult> {
  return call<ComposeResult>("ai_compose_commits", args);
}

export const applyComposedCommits = (
  repoId: string,
  treeId: string,
  commits: ComposedCommit[],
  authorName: string | null,
  authorEmail: string | null,
) => call<string[]>("apply_composed_commits", { repoId, treeId, commits, authorName, authorEmail });
