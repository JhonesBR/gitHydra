import type { CommitNode } from "@/features/commit-graph/types";

export type TodoAction = "pick" | "reword" | "squash" | "fixup" | "drop";

export const TODO_ACTIONS: TodoAction[] = ["pick", "reword", "squash", "fixup", "drop"];

export type TodoRow = {
  commit: CommitNode;
  action: TodoAction;
  /** Edited message, used when `action` is reword. */
  message: string;
};

/** What `start_interactive_rebase` takes, oldest first. */
export type TodoItem = { sha: string; action: TodoAction; message: string | null };

export function fullMessage(commit: CommitNode): string {
  return commit.body ? `${commit.summary}\n\n${commit.body}` : commit.summary;
}

export function initialRows(commits: CommitNode[]): TodoRow[] {
  return commits.map((commit) => ({ commit, action: "pick", message: fullMessage(commit) }));
}

export function moveRow<T>(rows: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return rows;
  const next = rows.slice();
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
}

/** Why the list can't run, or null. Mirrors the backend's checks. */
export function validateRows(rows: TodoRow[]): string | null {
  const kept = rows.filter((r) => r.action !== "drop");
  if (kept.length === 0) return "Every commit is dropped — nothing would be left to rebase.";
  if (kept[0].action === "squash" || kept[0].action === "fixup") {
    return "The first commit can't be squashed or fixed up: there's nothing before it to meld into.";
  }
  const emptyReword = rows.find((r) => r.action === "reword" && !r.message.trim());
  if (emptyReword) return `Commit ${emptyReword.commit.shortSha} needs a message to reword.`;
  return null;
}

/** True when running would change nothing (all picks, original order). */
export function isUnchanged(rows: TodoRow[], original: CommitNode[]): boolean {
  return rows.every(
    (r, i) =>
      r.commit.sha === original[i]?.sha &&
      (r.action === "pick" || (r.action === "reword" && r.message.trim() === fullMessage(r.commit).trim())),
  );
}

export function toItems(rows: TodoRow[]): TodoItem[] {
  return rows.map((r) => ({
    sha: r.commit.sha,
    action: r.action,
    message: r.action === "reword" ? r.message : null,
  }));
}

/** Single-key shortcuts on a focused row, like git's todo verbs. */
export function actionForKey(key: string): TodoAction | null {
  return ({ p: "pick", r: "reword", s: "squash", f: "fixup", d: "drop" } as const)[key.toLowerCase()] ?? null;
}
