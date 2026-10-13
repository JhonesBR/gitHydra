import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { ConfirmDialogHost } from "@/components/ConfirmDialogHost";
import { useEnsureDefaultProfile } from "@/features/profiles/useEnsureDefaultProfile";
import { closeRepository, openRepository } from "@/features/repository/api";
import { OpenRepoScreen } from "@/features/repository/OpenRepoScreen";
import { RepoView } from "@/features/repository/RepoView";
import { initTabsPersistence, useTabsStore } from "@/features/repository/store";
import { TabBar } from "@/features/repository/TabBar";
import { UnloadedTabView } from "@/features/repository/UnloadedTabView";
import { RepoSearchPalette } from "@/features/search/RepoSearchPalette";
import { SettingsModal } from "@/features/settings/SettingsModal";
import { SplashScreen } from "@/features/splash/SplashScreen";
import { queryClient } from "@/lib/query-client";
import { errorMessage } from "@/lib/tauri-client";
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
  // Launch splash: shown once per app start, while the open tabs get fetched.
  const [splashDone, setSplashDone] = useState(false);
  useTheme();
  const themeMode = useThemeMode();
  useEnsureDefaultProfile();
  useEffect(() => {
    initTabsPersistence();
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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ".") {
        e.preventDefault();
        setSettingsOpen(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "t") {
        e.preventDefault();
        openNewTab();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openNewTab]);

  const openRepoAtPath = async (path: string) => {
    try {
      const summary = await openRepository(path);
      openRepoInTab(activeTabId, summary);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-neutral-950 text-neutral-100">
        <TabBar onOpenSettings={() => setSettingsOpen(true)} />
        <div className="min-h-0 flex-1">
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
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {searchOpen && (
        <RepoSearchPalette onClose={() => setSearchOpen(false)} onOpenRepo={openRepoAtPath} />
      )}
      <ConfirmDialogHost />
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
