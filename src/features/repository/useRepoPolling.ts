import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { queryKeys } from "@/lib/query-keys";

// ponytail: fixed 5s cadence, bump if external changes (terminal commits,
// stashes, checkouts) need to show up faster than that.
const POLL_INTERVAL_MS = 5000;

/** Picks up changes made outside the app (terminal commits, checkouts,
 * stashes...) by invalidating the repo's core queries periodically and
 * whenever the window regains focus. workdirDiff is included so a file
 * created/edited outside the app doesn't sit stale in the diff cache while
 * workingStatus already lists it — otherwise clicking it does nothing until
 * some other action (stage/unstage) happens to invalidate the diff cache. */
export function useRepoPolling(repoId: string, active: boolean) {
  const queryClient = useQueryClient();
  const wasActive = useRef(false);

  useEffect(() => {
    // Background tabs stay mounted (just hidden), and a minimized window
    // keeps its timers: without this, every open tab reloaded its status,
    // log and diffs every 5s. Coming back catches up right away instead.
    if (!active) return;
    const invalidateAll = () => {
      for (const key of [
        queryKeys.repoStatus(repoId),
        queryKeys.commitLog(repoId),
        queryKeys.headCommit(repoId),
        queryKeys.branches(repoId),
        queryKeys.stashes(repoId),
        queryKeys.workingStatus(repoId),
        ["workdirDiff", repoId],
      ]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    };

    if (wasActive.current) invalidateAll();
    wasActive.current = true;
    const tick = () => {
      if (!document.hidden) invalidateAll();
    };
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    window.addEventListener("focus", invalidateAll);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", invalidateAll);
    };
  }, [repoId, queryClient, active]);
}
