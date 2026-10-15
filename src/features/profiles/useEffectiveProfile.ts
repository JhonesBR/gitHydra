import { useWorkspaces } from "@/features/workspaces/useWorkspaces";
import { useProfiles } from "./useProfiles";

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");

/** The profile for a repo: its workspace's profile when one is set (innermost
 * workspace wins), else the selected one. `workspace` is non-null when overridden. */
export function useEffectiveProfile(repoPath: string | null) {
  const { profiles, activeProfile } = useProfiles();
  const { workspaces } = useWorkspaces();
  const workspace = repoPath
    ? workspaces
        .filter(
          (w) =>
            w.profileId &&
            profiles.some((p) => p.id === w.profileId) &&
            !w.ignoredPaths.includes(repoPath) &&
            norm(repoPath).startsWith(`${norm(w.path)}/`),
        )
        .sort((a, b) => b.path.length - a.path.length)[0]
    : undefined;
  const override = workspace && profiles.find((p) => p.id === workspace.profileId);
  return { profile: override ?? activeProfile, workspace: override ? workspace : null };
}
