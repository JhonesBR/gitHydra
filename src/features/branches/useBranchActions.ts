import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getRebaseStatus, startRebase } from "@/features/rebase/api";
import { useRebaseStore } from "@/features/rebase/store";
import { confirm } from "@/lib/confirm-store";
import { queryKeys } from "@/lib/query-keys";
import { errorMessage } from "@/lib/tauri-client";
import {
  checkoutAt,
  checkoutBranch,
  checkoutCommitDetached,
  cherryPick,
  createBranch,
  deleteBranchBoth,
  deleteLocalBranch,
  deleteRemoteBranch,
  listBranches,
  mergeBranch,
  resetToCommit,
  resetToRef,
  syncBranchToRemote,
} from "./api";

export function useBranchActions(repoId: string) {
  const queryClient = useQueryClient();
  const setRebaseStatus = useRebaseStore((s) => s.setStatus);
  const rebaseInProgress = useRebaseStore((s) => s.status !== null);

  const { data: branches } = useQuery({
    queryKey: queryKeys.branches(repoId),
    queryFn: () => listBranches(repoId),
  });
  const localBranchNames = new Set((branches ?? []).filter((b) => !b.isRemote).map((b) => b.name));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.branches(repoId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.commitLog(repoId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.headCommit(repoId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.repoStatus(repoId) });
  };

  const checkout = useMutation({
    mutationFn: (name: string) => checkoutBranch(repoId, name),
    onSuccess: invalidate,
  });

  const checkoutAtCommit = useMutation({
    mutationFn: (vars: { name: string; targetSha: string; remoteName: string | null }) =>
      checkoutAt(repoId, vars.name, vars.targetSha, vars.remoteName),
    onSuccess: invalidate,
  });

  // Wrapped with toast.promise for a visible loading/success/error animation
  // during the branch switch, instead of the raw `.mutate()` failing silently.
  const checkoutWithFeedback = (name: string) =>
    toast.promise(checkout.mutateAsync(name), {
      loading: `Switching to ${name}...`,
      success: `Current branch: ${name}`,
      error: (e) => errorMessage(e),
    });

  const checkoutAtWithFeedback = (vars: { name: string; targetSha: string; remoteName: string | null }) =>
    toast.promise(checkoutAtCommit.mutateAsync(vars), {
      loading: `Switching to ${vars.name}...`,
      success: `Current branch: ${vars.name}`,
      error: (e) => errorMessage(e),
    });

  const create = useMutation({
    mutationFn: (vars: { name: string; startPoint: string | null }) =>
      createBranch(repoId, vars.name, vars.startPoint, true),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const rebaseOnto = useMutation({
    mutationFn: (onto: string) => startRebase(repoId, onto),
    onSuccess: (status) => {
      if (status.state === "Complete") invalidate();
      else setRebaseStatus(status);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const checkoutDetached = useMutation({
    mutationFn: (sha: string) => checkoutCommitDetached(repoId, sha),
    onSuccess: invalidate,
  });

  const checkoutDetachedWithFeedback = (sha: string) =>
    toast.promise(checkoutDetached.mutateAsync(sha), {
      loading: `Checking out ${sha.slice(0, 7)}...`,
      success: `HEAD detached at ${sha.slice(0, 7)}`,
      error: (e) => errorMessage(e),
    });

  const cherryPickCommit = useMutation({
    mutationFn: (vars: { sha: string; createCommit: boolean }) =>
      cherryPick(repoId, vars.sha, vars.createCommit),
    onSuccess: (result) => {
      invalidate();
      if (result.conflicts.length > 0) {
        toast.error(
          `Cherry-pick produced conflicts in ${result.conflicts.length} file(s): ` +
            `${result.conflicts.map((c) => c.path).join(", ")} — resolve manually and finish with a commit.`,
        );
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const cherryPickWithFeedback = (vars: { sha: string; createCommit: boolean }) =>
    toast.promise(cherryPickCommit.mutateAsync(vars), {
      loading: `Cherry-picking ${vars.sha.slice(0, 7)}...`,
      success: (result) =>
        result.conflicts.length > 0
          ? `Cherry-pick of ${vars.sha.slice(0, 7)} produced conflicts`
          : `Cherry-pick of ${vars.sha.slice(0, 7)} applied`,
      error: (e) => errorMessage(e),
    });

  // Cherry-picking a range only makes sense as commits (there's no sane
  // "changes only" for more than one), so it always creates a commit per
  // pick, oldest to newest, and stops at the first conflict — the rest are
  // left un-picked for the user to retry once that one's resolved.
  const cherryPickManyWithFeedback = async (shas: string[]) => {
    const toastId = "cherry-pick-many";
    toast.loading(`Cherry-picking ${shas.length} commits...`, { id: toastId });
    for (let i = 0; i < shas.length; i++) {
      const sha = shas[i];
      try {
        const result = await cherryPickCommit.mutateAsync({ sha, createCommit: true });
        if (result.conflicts.length > 0) {
          toast.error(
            `Cherry-pick stopped at commit ${i + 1}/${shas.length} (${sha.slice(0, 7)}) — conflicts in: ` +
              `${result.conflicts.map((c) => c.path).join(", ")}. Resolve, then retry the rest.`,
            { id: toastId },
          );
          return;
        }
      } catch (e) {
        toast.error(errorMessage(e), { id: toastId });
        return;
      }
    }
    toast.success(`${shas.length} commits cherry-picked`, { id: toastId });
  };

  const resetTo = useMutation({
    mutationFn: (vars: { sha: string; hard: boolean }) => resetToCommit(repoId, vars.sha, vars.hard),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: queryKeys.workingStatus(repoId) });
      queryClient.invalidateQueries({ queryKey: ["workdirDiff", repoId] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const resetToWithFeedback = (vars: { sha: string; hard: boolean }) =>
    toast.promise(resetTo.mutateAsync(vars), {
      loading: `Resetting to ${vars.sha.slice(0, 7)}...`,
      success: `Branch reset to ${vars.sha.slice(0, 7)}`,
      error: (e) => errorMessage(e),
    });

  // "Sync current branch to remote": autostash uncommitted changes, hard
  // reset to the remote's commit, re-apply the stash. A clean re-apply just
  // invalidates like any other checkout; a conflicted one hands off to the
  // same conflict-resolution UI rebase conflicts use (conflicts are
  // conflicts regardless of what produced them).
  const syncToRemote = useMutation({
    mutationFn: (targetSha: string) => syncBranchToRemote(repoId, targetSha),
    onSuccess: async (result) => {
      invalidate();
      if (result.conflicts.length === 0) return;
      const status = await getRebaseStatus(repoId);
      setRebaseStatus(status);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const syncToRemoteWithFeedback = (targetSha: string) =>
    toast.promise(syncToRemote.mutateAsync(targetSha), {
      loading: "Syncing branch with origin...",
      success: (r) =>
        r.conflicts.length > 0
          ? `Sync produced ${r.conflicts.length} conflict(s) — resolve them to finish`
          : "Branch synced with origin",
      error: (e) => errorMessage(e),
    });

  // Merges `origin` into `target`, checking `target` out first if it isn't
  // already current (a harmless no-op checkout when it already is). Always
  // creates a merge commit (never fast-forwards) named "Merge branch
  // '<origin>' into '<target>'". Conflicts hand off to the same
  // conflict-resolution UI rebase conflicts use (conflicts are conflicts
  // regardless of what produced them).
  const mergeInto = useMutation({
    mutationFn: async (vars: { origin: string; target: string }) => {
      await checkoutBranch(repoId, vars.target);
      return mergeBranch(repoId, vars.origin);
    },
    onSuccess: async (result) => {
      invalidate();
      if (result.conflicts.length === 0) return;
      const status = await getRebaseStatus(repoId);
      setRebaseStatus(status);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const mergeIntoWithFeedback = (vars: { origin: string; target: string }) =>
    toast.promise(mergeInto.mutateAsync(vars), {
      loading: `Merging ${vars.origin} into ${vars.target}...`,
      success: (r) =>
        r.conflicts.length > 0
          ? `Merging ${vars.origin} into ${vars.target} produced ${r.conflicts.length} conflict(s) — resolve them to finish`
          : `Merged ${vars.origin} into ${vars.target}`,
      error: (e) => errorMessage(e),
    });

  // Checks `target` out (no-op if already current) then hard-resets it to
  // `origin`'s tip — for "make this branch match that one" drag flows.
  // Destructive (any commits on target not reachable from origin are left
  // behind), so callers should confirm before calling the *WithConfirm form.
  const resetBranchTo = useMutation({
    mutationFn: async (vars: { origin: string; target: string }) => {
      await checkoutBranch(repoId, vars.target);
      return resetToRef(repoId, vars.origin, true);
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: queryKeys.workingStatus(repoId) });
      queryClient.invalidateQueries({ queryKey: ["workdirDiff", repoId] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const resetBranchToWithConfirm = async (vars: { origin: string; target: string }) => {
    const confirmed = await confirm(
      `Reset "${vars.target}" to match "${vars.origin}"? Any commits on "${vars.target}" not in "${vars.origin}" will no longer be part of its history.`,
      { title: "Reset branch", kind: "warning" },
    );
    if (!confirmed) return;
    toast.promise(resetBranchTo.mutateAsync(vars), {
      loading: `Resetting ${vars.target} to ${vars.origin}...`,
      success: `Reset ${vars.target} to ${vars.origin}`,
      error: (e) => errorMessage(e),
    });
  };

  const deleteLocal = useMutation({
    mutationFn: (name: string) => deleteLocalBranch(repoId, name),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const deleteRemote = useMutation({
    mutationFn: (name: string) => deleteRemoteBranch(repoId, "origin", name),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const deleteBoth = useMutation({
    mutationFn: (name: string) => deleteBranchBoth(repoId, "origin", name),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const deleteLocalWithConfirm = async (name: string) => {
    const confirmed = await confirm(`Delete local branch "${name}"? This cannot be undone.`, {
      title: "Delete branch",
      kind: "warning",
    });
    if (confirmed) deleteLocal.mutate(name);
  };
  const deleteRemoteWithConfirm = async (name: string) => {
    const confirmed = await confirm(`Delete branch "${name}" on origin? This cannot be undone.`, {
      title: "Delete remote branch",
      kind: "warning",
    });
    if (confirmed) deleteRemote.mutate(name);
  };
  const deleteBothWithConfirm = async (name: string) => {
    const confirmed = await confirm(
      `Delete branch "${name}" locally and on origin? This cannot be undone.`,
      { title: "Delete branch", kind: "warning" },
    );
    if (confirmed) deleteBoth.mutate(name);
  };

  return {
    checkout,
    checkoutAtCommit,
    checkoutWithFeedback,
    checkoutAtWithFeedback,
    create,
    rebaseOnto,
    rebaseInProgress,
    localBranchNames,
    checkoutDetached,
    checkoutDetachedWithFeedback,
    cherryPickCommit,
    cherryPickWithFeedback,
    cherryPickManyWithFeedback,
    resetTo,
    resetToWithFeedback,
    syncToRemote,
    syncToRemoteWithFeedback,
    mergeInto,
    mergeIntoWithFeedback,
    resetBranchTo,
    resetBranchToWithConfirm,
    deleteLocal,
    deleteRemote,
    deleteBoth,
    deleteLocalWithConfirm,
    deleteRemoteWithConfirm,
    deleteBothWithConfirm,
  };
}
