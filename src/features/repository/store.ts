import { create } from "zustand";
import { samePath } from "@/features/activity/format";
import { getConfig, setConfig } from "@/lib/config-store";
import type { RepoSummary } from "./api";

// `path` is remembered independently of `repo` so a tab can go back to
// `repo: null` (unloaded for memory control) without losing its identity —
// `repo === null && path === null` is the only state that renders the picker.
// Pinned tabs always sit in a contiguous group at the front of `tabs`.
export type Tab = {
  id: string;
  repo: RepoSummary | null;
  path: string | null;
  lastActiveAt: number;
  pinned: boolean;
};

/** Unpinned tabs before `id` — what "Close tabs to the left" closes. */
export const tabsToLeft = (tabs: Tab[], id: string): Tab[] => {
  const idx = tabs.findIndex((t) => t.id === id);
  return idx === -1 ? [] : tabs.slice(0, idx).filter((t) => !t.pinned);
};

/** Unpinned tabs after `id` — what "Close tabs to the right" closes. */
export const tabsToRight = (tabs: Tab[], id: string): Tab[] => {
  const idx = tabs.findIndex((t) => t.id === id);
  return idx === -1 ? [] : tabs.slice(idx + 1).filter((t) => !t.pinned);
};

type TabsStore = {
  tabs: Tab[];
  activeTabId: string;
  setTabRepo: (tabId: string, repo: RepoSummary | null) => void;
  openRepoInTab: (tabId: string, repo: RepoSummary) => void;
  openPathInNewTab: (path: string) => void;
  addTab: () => void;
  openNewTab: () => void;
  closeTab: (id: string) => void;
  closeTabs: (ids: string[], fallbackActiveId?: string) => void;
  togglePinTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  restoreTabs: (paths: string[], activeIndex: number, pinnedPaths?: string[]) => void;
};

const makeTab = (path: string | null = null): Tab => ({
  id: crypto.randomUUID(),
  repo: null,
  path,
  lastActiveAt: Date.now(),
  pinned: false,
});

const initialTab = makeTab();

export const useTabsStore = create<TabsStore>((set, get) => ({
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

  // Worktrees/submodules: a new tab that opens lazily (UnloadedTabView), or
  // the tab that already has that path.
  openPathInNewTab: (path) =>
    set((s) => {
      const existing = s.tabs.find((t) => samePath(t.path, path));
      if (existing) {
        return {
          activeTabId: existing.id,
          tabs: s.tabs.map((t) => (t.id === existing.id ? { ...t, lastActiveAt: Date.now() } : t)),
        };
      }
      const tab = makeTab(path);
      return { tabs: [...s.tabs, tab], activeTabId: tab.id };
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

  closeTab: (id) => get().closeTabs([id]),

  // If the active tab is among those closed, `fallbackActiveId` (when it
  // survives) takes over; otherwise the tab now at the active tab's old index.
  closeTabs: (ids, fallbackActiveId) =>
    set((s) => {
      const closing = new Set(ids);
      const activeIdx = s.tabs.findIndex((t) => t.id === s.activeTabId);
      const remaining = s.tabs.filter((t) => !closing.has(t.id));
      if (remaining.length === s.tabs.length) return s;
      const tabs = remaining.length ? remaining : [makeTab()];
      if (!closing.has(s.activeTabId)) return { tabs };
      const fallback = tabs.find((t) => t.id === fallbackActiveId);
      const activeTabId = fallback?.id ?? tabs[Math.min(Math.max(activeIdx, 0), tabs.length - 1)].id;
      return { tabs, activeTabId };
    }),

  // Pinning moves the tab to the end of the pinned group; unpinning moves it
  // to the first slot right after it.
  togglePinTab: (id) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id);
      if (!tab) return s;
      const others = s.tabs.filter((t) => t.id !== id);
      const pinnedCount = others.filter((t) => t.pinned).length;
      const toggled = { ...tab, pinned: !tab.pinned };
      return { tabs: [...others.slice(0, pinnedCount), toggled, ...others.slice(pinnedCount)] };
    }),

  setActiveTab: (id) =>
    set((s) => ({
      activeTabId: id,
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, lastActiveAt: Date.now() } : t)),
    })),

  // Rebuilds tabs from last session's paths — each reopens lazily via
  // UnloadedTabView (repo: null, path: set) once it becomes active, same as
  // the idle-unload/reload path, so there's no separate "restore" codepath.
  restoreTabs: (paths, activeIndex, pinnedPaths = []) => {
    if (paths.length === 0) return;
    const restored = paths.map((p) => ({
      ...makeTab(p),
      pinned: pinnedPaths.some((pp) => samePath(pp, p)),
    }));
    const active = restored[activeIndex] ?? restored[0];
    const tabs = [...restored.filter((t) => t.pinned), ...restored.filter((t) => !t.pinned)];
    set({ tabs, activeTabId: active.id });
  },
}));

const OPEN_TABS_KEY = "openTabs";
type PersistedTabs = { paths: string[]; activeIndex: number; pinned?: string[] };

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
  if (saved) useTabsStore.getState().restoreTabs(saved.paths, saved.activeIndex, saved.pinned);

  useTabsStore.subscribe((state) => {
    const paths = state.tabs.map((t) => t.path).filter((p): p is string => p !== null);
    const pinned = state.tabs.filter((t) => t.pinned && t.path !== null).map((t) => t.path as string);
    const activePath = state.tabs.find((t) => t.id === state.activeTabId)?.path ?? null;
    const activeIndex = activePath ? paths.indexOf(activePath) : -1;
    setConfig(OPEN_TABS_KEY, { paths, activeIndex, pinned });
  });
}
