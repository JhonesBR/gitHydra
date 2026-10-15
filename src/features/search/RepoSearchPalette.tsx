import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { FavoriteStar } from "@/features/workspaces/FavoriteStar";
import { favoritesFirst } from "@/features/workspaces/favorites";
import { useFavoriteRepos } from "@/features/workspaces/useFavoriteRepos";
import { useAllWorkspaceRepos } from "@/features/workspaces/useAllWorkspaceRepos";

export function RepoSearchPalette({
  onClose,
  onOpenRepo,
}: {
  onClose: () => void;
  onOpenRepo: (path: string) => void;
}) {
  const allRepos = useAllWorkspaceRepos();
  const fav = useFavoriteRepos();
  const repos = useMemo(() => favoritesFirst(allRepos, fav.favorites), [allRepos, fav.favorites]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q),
    );
  }, [repos, query]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  const openSelected = (index: number) => {
    const repo = filtered[index];
    if (repo) {
      onOpenRepo(repo.path);
      onClose();
    }
  };

  return (
    <Modal onClose={onClose} align="top">
      <div
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelected((s) => Math.min(s + 1, filtered.length - 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelected((s) => Math.max(s - 1, 0));
          }
          if (e.key === "Enter") {
            e.preventDefault();
            openSelected(selected);
          }
        }}
      >
        <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2.5">
          <Search size={15} className="shrink-0 text-neutral-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search repository..."
            className="min-w-0 flex-1 bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
          />
        </div>
        <ul className="max-h-80 overflow-auto p-1">
          {filtered.map((repo, i) => (
            <li
              key={repo.path}
              onMouseEnter={() => setSelected(i)}
              onClick={() => openSelected(i)}
              className={`flex cursor-pointer items-center gap-2 rounded px-3 py-2 ${
                i === selected ? "bg-neutral-800" : "hover:bg-neutral-900"
              }`}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm text-neutral-100">{repo.name}</span>
                <span className="truncate text-xs text-neutral-500">
                  {repo.workspaceName} — {repo.path}
                </span>
              </span>
              <FavoriteStar active={fav.isFavorite(repo.path)} onToggle={() => fav.toggle(repo.path)} />
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-sm text-neutral-500">No repositories found</li>
          )}
        </ul>
      </div>
    </Modal>
  );
}
