import { invoke } from "@tauri-apps/api/core";

export type GitCommandError =
  | { kind: "RepoNotFound"; details: { path: string } }
  | { kind: "Libgit2"; details: { code: string; class: string; message: string } }
  | { kind: "Internal"; details: string }
  | { kind: "PushRejectedNonFastForward"; details: { message: string } }
  | { kind: "SshPassphraseRequired"; details: { key: string } };

export function errorMessage(error: unknown): string {
  const e = error as GitCommandError;
  if (e?.details && typeof e.details === "object" && "message" in e.details) {
    return e.details.message;
  }
  if (typeof e?.details === "string") return e.details;
  if (e?.kind === "SshPassphraseRequired") return `SSH key ${e.details.key} is locked: fetch or push to enter its passphrase`;
  return String(error);
}

export function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}
