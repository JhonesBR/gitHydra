import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getConfig, setConfig } from "@/lib/config-store";
import { isFavorite, toggleFavorite } from "./favorites";

const KEY = ["favoriteRepos"] as const;

/** Repository paths the user starred, shown first on the open screen and in the palette. */
export function useFavoriteRepos() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: KEY, queryFn: () => getConfig<string[]>("favoriteRepos", []) });
  const favorites = data ?? [];
  return {
    favorites,
    isFavorite: (path: string) => isFavorite(favorites, path),
    toggle: (path: string) => {
      const next = toggleFavorite(favorites, path);
      queryClient.setQueryData(KEY, next);
      setConfig("favoriteRepos", next);
    },
  };
}
