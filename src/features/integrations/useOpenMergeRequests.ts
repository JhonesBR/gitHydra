import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { gitlabListOpenMergeRequests } from "./api";
import type { GitLabInstance, MergeRequestInfo } from "./types";

const POLL_INTERVAL_MS = 60_000;

/** Open MRs for the matched GitLab instance, keyed by source branch name.
 * Deliberately separate from `useRepoPolling`'s 5s local-git invalidation —
 * this hits an external, rate-limit-bound API, so it gets its own slower
 * interval. */
export function useOpenMergeRequests(
  repoId: string,
  instance: GitLabInstance | null,
  projectPath: string | null,
) {
  const { data } = useQuery({
    queryKey: queryKeys.gitlabOpenMrs(repoId),
    queryFn: () => gitlabListOpenMergeRequests(instance!.baseUrl, instance!.token, projectPath!),
    enabled: instance !== null && projectPath !== null,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const byBranch = new Map<string, MergeRequestInfo>();
  for (const mr of data ?? []) byBranch.set(mr.sourceBranch, mr);
  return byBranch;
}
