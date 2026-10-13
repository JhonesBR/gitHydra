import { useQuery } from "@tanstack/react-query";
import { getRemoteUrl } from "@/features/remote-ops/api";
import { queryKeys } from "@/lib/query-keys";
import { matchInstance, parseRemoteUrl } from "./provider";
import type { RemoteHosting } from "./types";
import { useIntegrationsSettings } from "./useIntegrationsSettings";

/** Resolves the repo's `origin` remote to a configured GitLab instance or
 * GitHub account, if any. `null` means either there's no `origin`, or its
 * host doesn't match anything configured — callers use that to hide
 * hosting-specific UI. The remote URL essentially never changes during a
 * session, so this is cached indefinitely per repo instead of polling. */
export function useHostingRemote(repoId: string): RemoteHosting | null {
  const { settings } = useIntegrationsSettings();

  const { data: remoteUrl } = useQuery({
    queryKey: queryKeys.remoteOriginUrl(repoId),
    queryFn: () => getRemoteUrl(repoId, "origin"),
    staleTime: Infinity,
  });

  if (!remoteUrl) return null;
  const projectPath = parseRemoteUrl(remoteUrl)?.path;
  if (!projectPath) return null;

  const gitlab = matchInstance(remoteUrl, settings.gitlab.instances);
  if (gitlab) return { provider: "gitlab", instance: gitlab, projectPath };
  const github = matchInstance(remoteUrl, settings.github.instances);
  if (github) return { provider: "github", instance: github, projectPath };
  return null;
}
