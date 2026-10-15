import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getConfig, setConfig } from "@/lib/config-store";

const KEY = ["autoUpdate"] as const;

/** Whether the app installs updates by itself at launch (on by default). */
export function useAutoUpdate() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: KEY, queryFn: () => getConfig<boolean>("autoUpdate", true) });
  return {
    loaded: data !== undefined,
    autoUpdate: data ?? true,
    setAutoUpdate: (next: boolean) => {
      queryClient.setQueryData(KEY, next);
      setConfig("autoUpdate", next);
    },
  };
}
