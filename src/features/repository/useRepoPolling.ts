import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { queryKeys } from "@/lib/query-keys";

// ponytail: fixed 5s cadence, bump if external changes (terminal commits,
// stashes, checkouts) need to show up faster than that.
const POLL_INTERVAL_MS = 5000;

/** Picks up changes made outside the app (terminal commits, checkouts,
 * stashes...) by invalidating the repo's core queries periodically and
 * whenever the window regains focus. Diff/scan queries are intentionally
 * left out — they're on-demand, not "is there something new" signals. */
export function useRepoPolling(repoId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const invalidateAll = () => {
      for (const key of [
        queryKeys.repoStatus(repoId),
        queryKeys.commitLog(repoId),
        queryKeys.branches(repoId),
        queryKeys.stashes(repoId),
        queryKeys.workingStatus(repoId),
      ]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    };

    const interval = setInterval(invalidateAll, POLL_INTERVAL_MS);
    window.addEventListener("focus", invalidateAll);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", invalidateAll);
    };
  }, [repoId, queryClient]);
}
