import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { errorMessage } from "@/lib/tauri-client";
import { stashApply, stashDrop, stashList, stashPop, stashSave } from "./api";

export function useStashActions(repoId: string) {
  const queryClient = useQueryClient();

  const { data: stashes } = useQuery({
    queryKey: queryKeys.stashes(repoId),
    queryFn: () => stashList(repoId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.stashes(repoId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.repoStatus(repoId) });
  };

  const reportConflicts = (action: string, conflicts: { path: string }[]) => {
    if (conflicts.length > 0) {
      toast.error(
        `${action} gerou conflitos em: ${conflicts.map((c) => c.path).join(", ")} — resolva manualmente.`,
      );
    }
  };

  const save = useMutation({
    mutationFn: (vars: { message: string | null; includeUntracked: boolean }) =>
      stashSave(repoId, vars.message, vars.includeUntracked),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const pop = useMutation({
    mutationFn: (index: number) => stashPop(repoId, index),
    onSuccess: (result) => {
      invalidate();
      reportConflicts("Pop", result.conflicts);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const apply = useMutation({
    mutationFn: (index: number) => stashApply(repoId, index),
    onSuccess: (result) => {
      invalidate();
      reportConflicts("Apply", result.conflicts);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const drop = useMutation({
    mutationFn: (index: number) => stashDrop(repoId, index),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });

  return { stashes, save, pop, apply, drop };
}
