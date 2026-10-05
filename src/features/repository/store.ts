import { create } from "zustand";
import type { RepoSummary } from "./api";

// `path` is remembered independently of `repo` so a tab can go back to
// `repo: null` (unloaded for memory control) without losing its identity —
// `repo === null && path === null` is the only state that renders the picker.
export type Tab = { id: string; repo: RepoSummary | null; path: string | null; lastActiveAt: number };

type TabsStore = {
  tabs: Tab[];
  activeTabId: string;
  setTabRepo: (tabId: string, repo: RepoSummary | null) => void;
  addTab: () => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
};

const makeTab = (): Tab => ({
  id: crypto.randomUUID(),
  repo: null,
  path: null,
  lastActiveAt: Date.now(),
});

const initialTab = makeTab();

export const useTabsStore = create<TabsStore>((set) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,

  setTabRepo: (tabId, repo) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, repo, path: repo ? repo.path : t.path } : t,
      ),
    })),

  addTab: () => {
    const tab = makeTab();
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  },

  closeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return s;
      const remaining = s.tabs.filter((t) => t.id !== id);
      const tabs = remaining.length ? remaining : [makeTab()];
      const activeTabId =
        s.activeTabId === id ? tabs[Math.min(idx, tabs.length - 1)].id : s.activeTabId;
      return { tabs, activeTabId };
    }),

  setActiveTab: (id) =>
    set((s) => ({
      activeTabId: id,
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, lastActiveAt: Date.now() } : t)),
    })),
}));
