import { create } from "zustand";
import type { RepoSummary } from "./api";

type RepoStore = {
  repo: RepoSummary | null;
  setRepo: (repo: RepoSummary | null) => void;
};

export const useRepoStore = create<RepoStore>((set) => ({
  repo: null,
  setRepo: (repo) => set({ repo }),
}));
