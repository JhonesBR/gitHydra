import { create } from "zustand";
import { getConfig, setConfig } from "@/lib/config-store";
import type { RepoSummary } from "./api";

// `path` is remembered independently of `repo` so a tab can go back to
// `repo: null` (unloaded for memory control) without losing its identity —
// `repo === null && path === null` is the only state that renders the picker.
export type Tab = { id: string; repo: RepoSummary | null; path: string | null; lastActiveAt: number };

type TabsStore = {
  tabs: Tab[];
  activeTabId: string;
  setTabRepo: (tabId: string, repo: RepoSummary | null) => void;
  openRepoInTab: (tabId: string, repo: RepoSummary) => void;
  addTab: () => void;
  openNewTab: () => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  restoreTabs: (paths: string[], activeIndex: number) => void;
};

const makeTab = (path: string | null = null): Tab => ({
  id: crypto.randomUUID(),
  repo: null,
  path,
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

  // If `repo.path` is already open in another tab, switches to it instead of
  // loading the same repo twice — dropping the requesting tab if it was just
  // a blank placeholder (e.g. one Ctrl/Cmd+T or "+" just created for this).
  openRepoInTab: (tabId, repo) =>
    set((s) => {
      const existing = s.tabs.find((t) => t.id !== tabId && t.path === repo.path);
      if (!existing) {
        return { tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, repo, path: repo.path } : t)) };
      }
      const requesting = s.tabs.find((t) => t.id === tabId);
      const requestingIsBlank = requesting?.repo === null && requesting?.path === null;
      const tabs = (requestingIsBlank ? s.tabs.filter((t) => t.id !== tabId) : s.tabs).map((t) =>
        t.id === existing.id ? { ...t, lastActiveAt: Date.now() } : t,
      );
      return { tabs, activeTabId: existing.id };
    }),

  addTab: () => {
    const tab = makeTab();
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  },

  // Reuses an already-open empty "Workspace" tab instead of piling up blanks —
  // shared by the TabBar "+" button and the Ctrl/Cmd+T shortcut.
  openNewTab: () =>
    set((s) => {
      const openWorkspace = s.tabs.find((t) => t.repo === null && t.path === null);
      if (openWorkspace) {
        return {
          activeTabId: openWorkspace.id,
          tabs: s.tabs.map((t) => (t.id === openWorkspace.id ? { ...t, lastActiveAt: Date.now() } : t)),
        };
      }
      const tab = makeTab();
      return { tabs: [...s.tabs, tab], activeTabId: tab.id };
    }),

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

  // Rebuilds tabs from last session's paths — each reopens lazily via
  // UnloadedTabView (repo: null, path: set) once it becomes active, same as
  // the idle-unload/reload path, so there's no separate "restore" codepath.
  restoreTabs: (paths, activeIndex) => {
    if (paths.length === 0) return;
    const tabs = paths.map((p) => makeTab(p));
    const active = tabs[activeIndex] ?? tabs[0];
    set({ tabs, activeTabId: active.id });
  },
}));

const OPEN_TABS_KEY = "openTabs";
type PersistedTabs = { paths: string[]; activeIndex: number };

/** Paths of the repo tabs left open last session — read straight from the
 * saved config, so it's right even before initTabsPersistence restores them. */
export async function getSavedTabPaths(): Promise<string[]> {
  const saved = await getConfig<PersistedTabs | null>(OPEN_TABS_KEY, null);
  return [...new Set(saved?.paths ?? [])];
}

/** Restores tabs left open from the previous session, then keeps saving on
 * every change (just the path references, not full repo state — those
 * reopen lazily like any unloaded tab). Call once at app startup. */
export async function initTabsPersistence() {
  const saved = await getConfig<PersistedTabs | null>(OPEN_TABS_KEY, null);
  if (saved) useTabsStore.getState().restoreTabs(saved.paths, saved.activeIndex);

  useTabsStore.subscribe((state) => {
    const paths = state.tabs.map((t) => t.path).filter((p): p is string => p !== null);
    const activePath = state.tabs.find((t) => t.id === state.activeTabId)?.path ?? null;
    const activeIndex = activePath ? paths.indexOf(activePath) : -1;
    setConfig(OPEN_TABS_KEY, { paths, activeIndex });
  });
}
