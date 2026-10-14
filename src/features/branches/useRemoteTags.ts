import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { listRemoteTags } from "./api";

/** Tag names on origin (network call; failures just mean "unknown" = undefined list → []). */
export function useRemoteTags(repoId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.remoteTags(repoId),
    queryFn: () => listRemoteTags(repoId, "origin").catch(() => [] as string[]),
    enabled,
  }).data;
}
