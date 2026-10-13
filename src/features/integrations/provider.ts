import type { GitLabInstance } from "./types";

export type ParsedRemote = { host: string; path: string };

/** Parses a git remote URL into `{ host, path }`, handling both the scp-like
 * SSH form (`git@host:owner/repo.git`) and URL forms
 * (`https://host/owner/repo.git`, `ssh://git@host:port/owner/repo.git`).
 * `path` is the project path with any `.git` suffix and leading/trailing
 * slashes stripped (e.g. `group/subgroup/repo`). Returns `null` for anything
 * that doesn't match a recognizable remote URL shape. */
export function parseRemoteUrl(url: string): ParsedRemote | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const schemeMatch = trimmed.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i);
  if (schemeMatch) {
    const [, host, path] = schemeMatch;
    return { host, path: stripProjectPath(path) };
  }

  const scpMatch = trimmed.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/);
  if (scpMatch) {
    const [, host, path] = scpMatch;
    return { host, path: stripProjectPath(path) };
  }

  return null;
}

function stripProjectPath(path: string): string {
  return path.replace(/\.git$/, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

/** Finds the configured GitLab instance whose base URL hostname matches the
 * repo's remote URL, or `null` if none does (including when the remote URL
 * can't be parsed at all) — the caller uses `null` to hide GitLab-specific UI. */
export function matchGitLabInstance(remoteUrl: string, instances: GitLabInstance[]): GitLabInstance | null {
  const parsed = parseRemoteUrl(remoteUrl);
  if (!parsed) return null;
  const remoteHost = parsed.host.toLowerCase();
  return (
    instances.find((instance) => {
      try {
        return new URL(instance.baseUrl).hostname.toLowerCase() === remoteHost;
      } catch {
        return false;
      }
    }) ?? null
  );
}
