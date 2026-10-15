/** The folder to open from a drop: the first dropped path (a repo is a folder; the rest are ignored). */
export function droppedRepoPath(paths: string[]): string | null {
  return paths.find((p) => p.trim() !== "") ?? null;
}
