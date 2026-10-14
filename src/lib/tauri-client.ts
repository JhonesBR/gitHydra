import { invoke } from "@tauri-apps/api/core";
import { commandLine, commandRepoPath, isRead, isSkipped, redact } from "@/features/activity/format";
import { rememberRepoPath, repoPathOf, useActivityStore } from "@/features/activity/store";

export type GitCommandError =
  | { kind: "RepoNotFound"; details: { path: string } }
  | { kind: "Libgit2"; details: { code: string; class: string; message: string } }
  | { kind: "Internal"; details: string }
  | { kind: "PushRejectedNonFastForward"; details: { message: string } }
  | { kind: "SshPassphraseRequired"; details: { key: string } }
  | { kind: "HttpsCredentialsRequired"; details: { url: string } }
  | { kind: "RemoteRequired"; details: { remotes: string[] } }
  | { kind: "NoUpstream"; details: { branch: string } }
  | { kind: "PullNotFastForward"; details: { upstream: string } }
  | { kind: "HookFailed"; details: { hook: string; output: string } }
  | { kind: "SigningFailed"; details: { message: string } };

/** A background operation skipped because it would need a secret (SSH key
 * passphrase, HTTPS credentials) that only operations the user starts ask
 * for — not a failure worth reporting. */
export function isAuthSkip(error: unknown): boolean {
  const kind = (error as GitCommandError)?.kind;
  return kind === "SshPassphraseRequired" || kind === "HttpsCredentialsRequired";
}

/** Last lines of a failed hook's output: the error is usually at the end
 * (the full output is in the Activity Logs). */
export function hookOutputTail(output: string, maxLines = 12): string {
  const lines = output.trimEnd().split(/\r?\n/);
  return (lines.length > maxLines ? ["…", ...lines.slice(-maxLines)] : lines).join("\n");
}

/** `{ hook, output }` when a commit was aborted by a git hook. */
export function hookFailure(error: unknown): { hook: string; output: string } | null {
  const e = error as GitCommandError;
  return e?.kind === "HookFailed" ? e.details : null;
}

export function errorMessage(error: unknown): string {
  const e = error as GitCommandError;
  if (e?.kind === "HookFailed") {
    const tail = hookOutputTail(e.details.output);
    return tail ? `${e.details.hook} hook failed:\n${tail}` : `${e.details.hook} hook failed`;
  }
  if (e?.kind === "SigningFailed") return `Could not sign the commit: ${e.details.message}`;
  if (e?.details && typeof e.details === "object" && "message" in e.details) {
    return e.details.message;
  }
  if (typeof e?.details === "string") return e.details;
  if (e?.kind === "SshPassphraseRequired") return `SSH key ${e.details.key} is locked: fetch or push to enter its passphrase`;
  if (e?.kind === "HttpsCredentialsRequired")
    return `${e.details.url} needs a username and password/token: fetch or push to enter them`;
  if (e?.kind === "RemoteRequired")
    return e.details.remotes.length ? "Choose a remote to push to" : "This repository has no remotes: add one in Remotes (… menu)";
  if (e?.kind === "NoUpstream") return `Branch ${e.details.branch} has no upstream to pull from — push it first`;
  if (e?.kind === "PullNotFastForward") return `Can't fast-forward: ${e.details.upstream} has diverged`;
  return String(error);
}

/** Every backend call goes through here, which also feeds the Activity Logs. */
export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isSkipped(cmd)) return invoke<T>(cmd, args);
  const log = useActivityStore.getState();
  const started = performance.now();
  const id = log.add({
    source: "command",
    text: commandLine(cmd, args),
    read: isRead(cmd),
    repoPath: commandRepoPath(cmd, args, repoPathOf),
    status: "running",
    args: redact(args),
  });
  try {
    const result = await invoke<T>(cmd, args);
    if (cmd === "open_repository") {
      const repo = result as { repoId: string; path: string };
      rememberRepoPath(repo.repoId, repo.path);
    }
    log.finish(id, { status: "ok", durationMs: performance.now() - started });
    return result;
  } catch (e) {
    log.finish(id, { status: "error", durationMs: performance.now() - started, error: errorMessage(e) });
    throw e;
  }
}
