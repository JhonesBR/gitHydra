import { samePath } from "@/features/activity/format";

export const isFavorite = (favorites: string[], path: string) => favorites.some((f) => samePath(f, path));

/** Adds `path`, or removes it when it's already a favorite. */
export const toggleFavorite = (favorites: string[], path: string): string[] =>
  isFavorite(favorites, path) ? favorites.filter((f) => !samePath(f, path)) : [...favorites, path];

/** Favorites first, each group in its original order. */
export const favoritesFirst = <T extends { path: string }>(items: T[], favorites: string[]): T[] => [
  ...items.filter((i) => isFavorite(favorites, i.path)),
  ...items.filter((i) => !isFavorite(favorites, i.path)),
];
