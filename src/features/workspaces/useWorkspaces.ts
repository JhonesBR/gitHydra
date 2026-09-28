import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getConfig, setConfig } from "@/lib/config-store";
import { basename } from "@/lib/path";
import type { WorkspaceEntry } from "./types";

const WORKSPACES_KEY = ["workspaces"] as const;

export function useWorkspaces() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: WORKSPACES_KEY,
    queryFn: () => getConfig<WorkspaceEntry[]>("workspaces", []),
  });
  // Fallback for workspaces saved before names/ignoredPaths existed.
  const workspaces = (data ?? []).map((w) => ({
    ...w,
    name: w.name || basename(w.path),
    ignoredPaths: w.ignoredPaths ?? [],
  }));

  const persist = async (next: WorkspaceEntry[]) => {
    await setConfig("workspaces", next);
    queryClient.invalidateQueries({ queryKey: WORKSPACES_KEY });
  };

  const addWorkspace = (path: string, name: string) =>
    persist([...workspaces, { id: crypto.randomUUID(), name, path, ignoredPaths: [] }]);

  const renameWorkspace = (id: string, name: string) =>
    persist(workspaces.map((w) => (w.id === id ? { ...w, name } : w)));

  const setIgnoredPaths = (id: string, ignoredPaths: string[]) =>
    persist(workspaces.map((w) => (w.id === id ? { ...w, ignoredPaths } : w)));

  const removeWorkspace = (id: string) => persist(workspaces.filter((w) => w.id !== id));

  return { workspaces, addWorkspace, renameWorkspace, setIgnoredPaths, removeWorkspace };
}
