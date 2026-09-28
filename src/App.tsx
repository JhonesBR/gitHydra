import { QueryClientProvider } from "@tanstack/react-query";
import { Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { ConfirmDialogHost } from "@/components/ConfirmDialogHost";
import { ProfileSelector } from "@/features/profiles/ProfileSelector";
import { useEnsureDefaultProfile } from "@/features/profiles/useEnsureDefaultProfile";
import { openRepository } from "@/features/repository/api";
import { OpenRepoScreen } from "@/features/repository/OpenRepoScreen";
import { RepoView } from "@/features/repository/RepoView";
import { useRepoStore } from "@/features/repository/store";
import { RepoSearchPalette } from "@/features/search/RepoSearchPalette";
import { SettingsModal } from "@/features/settings/SettingsModal";
import { queryClient } from "@/lib/query-client";
import { errorMessage } from "@/lib/tauri-client";
import { useTheme } from "@/lib/use-theme";
import "./App.css";

function AppShell() {
  const repo = useRepoStore((s) => s.repo);
  const setRepo = useRepoStore((s) => s.setRepo);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  useTheme();
  useEnsureDefaultProfile();

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
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const openRepoAtPath = async (path: string) => {
    try {
      const summary = await openRepository(path);
      setRepo(summary);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      {repo ? <RepoView /> : <OpenRepoScreen />}
      <div className="fixed right-3 top-3 z-50 flex items-center gap-2">
        <button
          onClick={() => setSettingsOpen(true)}
          title="Settings (Ctrl+.)"
          className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          <Settings size={16} />
        </button>
        <ProfileSelector />
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {searchOpen && (
        <RepoSearchPalette onClose={() => setSearchOpen(false)} onOpenRepo={openRepoAtPath} />
      )}
      <ConfirmDialogHost />
      <Toaster theme="dark" position="bottom-right" closeButton />
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
