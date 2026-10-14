/** The remote used when nothing more specific applies: `origin` if there is
 * one, else the first. Same rule as the backend's push fallback. */
export function defaultRemote(names: readonly string[]): string | null {
  return names.includes("origin") ? "origin" : (names[0] ?? null);
}

/** Splits a remote-tracking branch name ("origin/feat/x") into its remote and
 * branch. The remote is the first segment, as git's default refspec lays it out. */
export function splitRemoteBranch(fullName: string): { remote: string; branch: string } {
  const idx = fullName.indexOf("/");
  return idx === -1
    ? { remote: fullName, branch: "" }
    : { remote: fullName.slice(0, idx), branch: fullName.slice(idx + 1) };
}

/** Problem with a remote name typed into the Remotes dialog, or null if it's
 * fine. Mirrors the common cases of git's own check (the backend has the final say). */
export function remoteNameProblem(name: string, existing: readonly string[], current?: string): string | null {
  const n = name.trim();
  if (!n) return "Name is required";
  if (n !== current && existing.includes(n)) return `A remote named "${n}" already exists`;
  if (/[\s~^:?*[\\]|\.\.|@\{|^[./-]|[./]$|\.lock$/.test(n)) return "Not a valid remote name";
  return null;
}

export const AUTO_FETCH_CHOICES = [0, 5, 10, 15, 30] as const;
export const DEFAULT_AUTO_FETCH_MINUTES = 10;

/** Open repos due for a periodic fetch, the longest-waiting first: their last
 * fetch (of any kind) ended at least `intervalMs` ago — or never happened —
 * and none is running right now. */
export function dueForAutoFetch(
  repoIds: readonly string[],
  lastFetchedAt: (repoId: string) => number | undefined,
  isFetching: (repoId: string) => boolean,
  now: number,
  intervalMs: number,
): string[] {
  return [...new Set(repoIds)]
    .filter((id) => !isFetching(id))
    .map((id) => [id, lastFetchedAt(id) ?? 0] as const)
    .filter(([, last]) => now - last >= intervalMs)
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id);
}
