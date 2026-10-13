import { useQuery } from "@tanstack/react-query";
import { getRemoteUrl } from "@/features/remote-ops/api";
import { queryKeys } from "@/lib/query-keys";
import { matchGitLabInstance, parseRemoteUrl } from "./provider";
import { useIntegrationsSettings } from "./useIntegrationsSettings";

/** Resolves the repo's `origin` remote to a configured GitLab instance, if
 * any. `null` means either there's no `origin`, or its host doesn't match any
 * configured instance — callers use that to hide GitLab-specific UI. The
 * remote URL essentially never changes during a session, so this is cached
 * indefinitely per repo instead of polling. */
export function useGitLabRemote(repoId: string) {
  const { settings } = useIntegrationsSettings();

  const { data: remoteUrl } = useQuery({
    queryKey: queryKeys.remoteOriginUrl(repoId),
    queryFn: () => getRemoteUrl(repoId, "origin"),
    staleTime: Infinity,
  });

  if (!remoteUrl) return { instance: null, projectPath: null };

  const instance = matchGitLabInstance(remoteUrl, settings.gitlab.instances);
  const projectPath = instance ? (parseRemoteUrl(remoteUrl)?.path ?? null) : null;

  return { instance, projectPath };
}
