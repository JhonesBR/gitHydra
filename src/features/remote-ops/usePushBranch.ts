import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { confirm } from "@/lib/confirm-store";
import { queryKeys } from "@/lib/query-keys";
import type { GitCommandError } from "@/lib/tauri-client";
import { errorMessage } from "@/lib/tauri-client";
import { fetchRemote, pushBranch } from "./api";

/** Push to origin as the top-bar button does it: fetch first, then push, and
 * on a non-fast-forward rejection offer a force push. Shared by the Push
 * button and the branch context menus. */
export function usePushBranch(repoId: string) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.branches(repoId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.commitLog(repoId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.headCommit(repoId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.repoStatus(repoId) });
  };

  const fetchMutation = useMutation({
    mutationFn: () => fetchRemote(repoId, "origin"),
  });
  const pushMutation = useMutation({
    mutationFn: (vars: { branch: string; force: boolean }) => pushBranch(repoId, "origin", vars.branch, vars.force),
  });

  const push = async (branch: string, force = false, skipFetch = false): Promise<void> => {
    if (!skipFetch) {
      toast.loading(`Fetching from remote before push...`, { id: "push" });
      try {
        await fetchMutation.mutateAsync();
      } catch (e) {
        toast.error(`Fetch before push failed: ${errorMessage(e)}`, { id: "push" });
        return;
      }
      invalidate();
    }

    toast.loading(force ? `Force pushing ${branch}...` : `Pushing ${branch}...`, { id: "push" });
    try {
      const s = await pushMutation.mutateAsync({ branch, force });
      invalidate();
      toast.success(`Push complete for ${s.branch}`, { id: "push" });
    } catch (e) {
      const err = e as GitCommandError;
      if (!force && err?.kind === "PushRejectedNonFastForward") {
        toast.dismiss("push");
        const confirmed = await confirm(
          "The remote has commits you don't have locally. Force pushing will overwrite the remote history. Continue?",
          { title: "Force push", kind: "warning" },
        );
        if (confirmed) return push(branch, true, true);
        return;
      }
      toast.error(errorMessage(e), { id: "push" });
    }
  };

  return { push, fetchMutation, pushMutation, invalidate };
}
