import type { PullResult, PullStrategy, UpstreamStatus } from "./types";

export const STRATEGY_LABELS: Record<PullStrategy, string> = {
  Merge: "Pull (fast-forward if possible, else merge)",
  FfOnly: "Pull (fast-forward only)",
  Rebase: "Pull (rebase)",
};

/** Dropdown entries, the configured default first and marked as such. */
export function strategyOptions(configured: PullStrategy | undefined): { strategy: PullStrategy; label: string }[] {
  const all: PullStrategy[] = ["Merge", "FfOnly", "Rebase"];
  const ordered = configured ? [configured, ...all.filter((s) => s !== configured)] : all;
  return ordered.map((strategy) => ({
    strategy,
    label: strategy === configured ? `${STRATEGY_LABELS[strategy]} — default` : STRATEGY_LABELS[strategy],
  }));
}

/** Button tooltip: where the branch stands and what a click will do. */
export function pullTitle(status: UpstreamStatus | null | undefined): string {
  if (!status) return "No upstream branch to pull from";
  const counts =
    status.ahead === 0 && status.behind === 0
      ? `Up to date with ${status.upstream} (as of the last fetch)`
      : `${status.behind} behind, ${status.ahead} ahead of ${status.upstream}`;
  return `${counts}\n${STRATEGY_LABELS[status.strategy]} — right-click for other options`;
}

const plural = (n: number) => `${n} commit${n === 1 ? "" : "s"}`;

/** Success toast text, or null when it stopped on conflicts (the conflict panel takes over). */
export function pullSummary(r: PullResult): string | null {
  switch (r.outcome) {
    case "UpToDate":
      return `Already up to date with ${r.upstream}`;
    case "FastForwarded":
      return `Fast-forwarded ${plural(r.commits)} from ${r.upstream}`;
    case "Merged":
      return `Merged ${plural(r.commits)} from ${r.upstream}`;
    case "Rebased":
      return `Rebased onto ${r.upstream} (${plural(r.commits)} pulled)`;
    case "Conflicts":
      return null;
  }
}
