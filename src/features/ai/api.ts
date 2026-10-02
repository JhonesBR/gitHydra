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
