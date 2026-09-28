import { useQueries } from "@tanstack/react-query";
import { scanWorkspace } from "./api";
import { useWorkspaces } from "./useWorkspaces";

/** Flattens every repo found across every workspace, tagged with the
 * workspace it came from. Reuses the same `["workspaceScan", id]` query key
 * `WorkspaceEntryRow` uses, so an already-expanded workspace's scan is
 * shared rather than refetched. */
export function useAllWorkspaceRepos() {
  const { workspaces } = useWorkspaces();
  const results = useQueries({
    queries: workspaces.map((ws) => ({
      queryKey: ["workspaceScan", ws.id],
      queryFn: () => scanWorkspace(ws.path),
    })),
  });

  return workspaces.flatMap((ws, i) =>
    (results[i]?.data ?? [])
      .filter((repo) => !ws.ignoredPaths.includes(repo.path))
      .map((repo) => ({ ...repo, workspaceName: ws.name })),
  );
}
