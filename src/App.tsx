import { QueryClientProvider } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { ConfirmDialogHost } from "@/components/ConfirmDialogHost";
import { ActivityLogDock, ActivityLogHost } from "@/features/activity/ActivityLogHost";
import { initActivityLog, useActivityStore } from "@/features/activity/store";
import { SshPassphraseHost } from "@/components/SshPassphraseHost";
import { HttpsCredentialsHost } from "@/components/HttpsCredentialsHost";
import { useAutoFetch } from "@/features/remote-ops/useAutoFetch";
import { useEnsureDefaultProfile } from "@/features/profiles/useEnsureDefaultProfile";
import { closeRepository, openRepository } from "@/features/repository/api";
import { OpenRepoScreen } from "@/features/repository/OpenRepoScreen";
import { RepoView } from "@/features/repository/RepoView";
import { initTabsPersistence, useTabsStore } from "@/features/repository/store";
import { TabBar } from "@/features/repository/TabBar";
import { UnloadedTabView } from "@/features/repository/UnloadedTabView";
import { takeInitialPath } from "@/features/cli/api";
import { droppedRepoPath } from "@/features/repository/droppedPaths";
import { RepoSearchPalette } from "@/features/search/RepoSearchPalette";
import { ShortcutsReference } from "@/features/shortcuts/ShortcutsReference";
import { useShortcut } from "@/features/shortcuts/useShortcuts";
import { lazyNamed } from "@/lib/lazy";

const SettingsModal = lazyNamed(() => import("@/features/settings/SettingsModal"), "SettingsModal");
import { SplashScreen } from "@/features/splash/SplashScreen";
import { queryClient } from "@/lib/query-client";
import { errorMessage } from "@/lib/tauri-client";
import { useApplyFonts } from "@/lib/fonts";
import { useTheme, useThemeMode } from "@/lib/use-theme";
import "./App.css";

const IDLE_UNLOAD_MS = 5 * 60 * 1000;
const IDLE_CHECK_INTERVAL_MS = 30_000;

function AppShell() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const setTabRepo = useTabsStore((s) => s.setTabRepo);
  const openRepoInTab = useTabsStore((s) => s.openRepoInTab);
  const openNewTab = useTabsStore((s) => s.openNewTab);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Launch splash: shown once per app start, while the open tabs get fetched.
  const [splashDone, setSplashDone] = useState(false);
  useTheme();
  useApplyFonts();
  const themeMode = useThemeMode();
  useEnsureDefaultProfile();
  useAutoFetch();
  useEffect(() => {
    // The CLI path opens as a tab after last session's tabs are restored
    // (restoring replaces the tab list).
    initTabsPersistence()
      .then(takeInitialPath)
      .then((path) => path && useTabsStore.getState().openPathInNewTab(path))
      .catch(() => {});
    initActivityLog();
    // `githydra -p <path>` while the app is already running.
    const unlisten = listen<string>("open-path", (e) => useTabsStore.getState().openPathInNewTab(e.payload));
    return () => void unlisten.then((fn) => fn());
  }, []);

  // Memory control: a repo tab that's sat in the background for 5+ minutes
  // gets its backend session closed; UnloadedTabView reopens it on demand
  // once the tab is activated again.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      for (const tab of tabsRef.current) {
        if (tab.id === activeTabIdRef.current || !tab.repo) continue;
        if (now - tab.lastActiveAt > IDLE_UNLOAD_MS) {
          closeRepository(tab.repo.repoId).catch(() => {});
          setTabRepo(tab.id, null);
        }
      }
    }, IDLE_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [setTabRepo]);

  useEffect(() => {
    // No browser-style Back/Forward/Reload/Inspect menu — only our own
    // custom context menus (e.g. right-clicking a branch pill) show up.
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  const stop = (fn: () => void) => (e: KeyboardEvent) => {
    e.preventDefault();
    fn();
  };
  useShortcut("searchRepos", stop(() => setSearchOpen(true)));
  useShortcut("openSettings", stop(() => setSettingsOpen(true)));
  useShortcut("showShortcuts", stop(() => setShortcutsOpen(true)));
  useShortcut("newTab", stop(openNewTab));
  // Not inside the terminal, where Ctrl+L clears the screen.
  useShortcut("toggleActivityLog", (e) => {
    if (e.target instanceof Element && e.target.closest(".xterm")) return;
    e.preventDefault();
    useActivityStore.getState().toggle();
  });

  // Dropping a folder on the window opens it as a repository in the active tab.
  const [dropping, setDropping] = useState(false);
  const openDropped = useRef<(path: string) => void>(() => {});
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const { type } = event.payload;
      if (type === "enter" || type === "over") setDropping(true);
      else setDropping(false);
      if (type === "drop") {
        const path = droppedRepoPath(event.payload.paths);
        if (path) openDropped.current(path);
      }
    });
    return () => void unlisten.then((fn) => fn());
  }, []);

  const openRepoAtPath = async (path: string) => {
    try {
      const summary = await openRepository(path);
      openRepoInTab(activeTabId, summary);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  openDropped.current = openRepoAtPath;

  return (
    <>
      {dropping && (
        <div className="pointer-events-none fixed inset-0 z-[300] flex items-center justify-center bg-black/50 text-lg text-neutral-100 outline-dashed outline-2 -outline-offset-8 outline-emerald-500">
          Drop a folder to open it as a repository
        </div>
      )}
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-neutral-950 text-neutral-100">
        <TabBar onOpenSettings={() => setSettingsOpen(true)} />
        <div className="flex min-h-0 flex-1">
          <ActivityLogDock side="left" />
          <div className="min-w-0 flex-1">
          {tabs.map((tab) => (
            <div key={tab.id} className={tab.id === activeTabId ? "h-full" : "hidden"}>
              {tab.repo ? (
                <RepoView tabId={tab.id} repo={tab.repo} />
              ) : tab.path ? (
                <UnloadedTabView tabId={tab.id} path={tab.path} />
              ) : (
                <OpenRepoScreen tabId={tab.id} />
              )}
            </div>
          ))}
          </div>
          <ActivityLogDock side="right" />
        </div>
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {shortcutsOpen && <ShortcutsReference onClose={() => setShortcutsOpen(false)} />}
      {searchOpen && (
        <RepoSearchPalette onClose={() => setSearchOpen(false)} onOpenRepo={openRepoAtPath} />
      )}
      <ActivityLogHost />
      <ConfirmDialogHost />
      <SshPassphraseHost />
      <HttpsCredentialsHost />
      {!splashDone && <SplashScreen onDone={() => setSplashDone(true)} />}
      <Toaster theme={themeMode} position="bottom-right" closeButton />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  );
}

export default App;
