import { useEffect, useState } from "react";
import { basename } from "@/lib/path";
import { errorMessage } from "@/lib/tauri-client";
import { openRepository } from "./api";
import { useTabsStore } from "./store";

// Shown for a tab whose repo was unloaded by the idle-memory control (see
// App.tsx) while it was in the background. Reopens automatically once this
// tab becomes the active one again.
export function UnloadedTabView({ tabId, path }: { tabId: string; path: string }) {
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const setTabRepo = useTabsStore((s) => s.setTabRepo);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tabId !== activeTabId) return;
    let cancelled = false;
    setError(null);
    openRepository(path)
      .then((summary) => {
        if (!cancelled) setTabRepo(tabId, summary);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [tabId, activeTabId, path, setTabRepo]);

  return (
    <main className="flex h-full w-full flex-col items-center justify-center gap-2 bg-neutral-950 text-sm text-neutral-400">
      {error ? (
        <p className="text-red-400">{error}</p>
      ) : (
        <p>Reopening {basename(path)}…</p>
      )}
    </main>
  );
}
