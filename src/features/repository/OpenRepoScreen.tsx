import { open } from "@tauri-apps/plugin-dialog";
import { Search } from "lucide-react";
import { useState } from "react";
import { WorkspaceEntryRow } from "@/features/workspaces/WorkspaceEntryRow";
import { useWorkspaces } from "@/features/workspaces/useWorkspaces";
import { basename } from "@/lib/path";
import { errorMessage } from "@/lib/tauri-client";
import { openRepository } from "./api";
import { useTabsStore } from "./store";

export function OpenRepoScreen({ tabId }: { tabId: string }) {
  const openRepoInTab = useTabsStore((s) => s.openRepoInTab);
  const { workspaces, addWorkspace, renameWorkspace, setIgnoredPaths, removeWorkspace } =
    useWorkspaces();
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [pendingWorkspace, setPendingWorkspace] = useState<{ path: string; name: string } | null>(
    null,
  );

  const openPath = async (path: string) => {
    setError(null);
    try {
      const summary = await openRepository(path);
      openRepoInTab(tabId, summary);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const handleAddWorkspace = async () => {
    const path = await open({ directory: true, multiple: false });
    if (!path) return;
    setPendingWorkspace({ path, name: basename(path) });
  };

  const confirmAddWorkspace = () => {
    if (!pendingWorkspace || !pendingWorkspace.name.trim()) return;
    addWorkspace(pendingWorkspace.path, pendingWorkspace.name.trim());
    setPendingWorkspace(null);
  };

  const handleOpenOther = async () => {
    const path = await open({ directory: true, multiple: false });
    if (!path) return;
    await openPath(path);
  };

  return (
    <main className="flex h-full w-full flex-col items-center gap-6 overflow-auto bg-neutral-950 p-8 text-neutral-100">
      <div className="flex items-center gap-2">
        <img src="/logo.svg" alt="" className="h-8 w-8" />
        <h1 className="text-2xl font-semibold">gitHydra</h1>
      </div>

      <div className="w-full max-w-7xl space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-300">Workspaces</h2>
          <button
            onClick={handleAddWorkspace}
            className="rounded bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700"
          >
            + Add workspace
          </button>
        </div>

        {pendingWorkspace && (
          <div className="space-y-2 rounded border border-neutral-700 bg-neutral-900 p-3">
            <p className="truncate text-xs text-neutral-500">{pendingWorkspace.path}</p>
            <div className="flex gap-2">
              <input
                autoFocus
                value={pendingWorkspace.name}
                onChange={(e) => {
                  const name = e.currentTarget.value;
                  setPendingWorkspace((p) => (p ? { ...p, name } : p));
                }}
                onKeyDown={(e) => e.key === "Enter" && confirmAddWorkspace()}
                placeholder="Workspace name"
                className="min-w-0 flex-1 rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
              />
              <button
                onClick={confirmAddWorkspace}
                disabled={!pendingWorkspace.name.trim()}
                className="shrink-0 rounded bg-neutral-700 px-3 py-1 text-sm hover:bg-neutral-600 disabled:opacity-50"
              >
                Add
              </button>
              <button
                onClick={() => setPendingWorkspace(null)}
                className="shrink-0 rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {workspaces.length > 0 && (
          <label className="flex items-center gap-1.5 rounded bg-neutral-900 px-2 py-1.5 text-neutral-500">
            <Search size={14} className="shrink-0" />
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Escape" && setFilter("")}
              placeholder="Filter repositories"
              className="min-w-0 flex-1 bg-transparent text-sm text-neutral-200 outline-none placeholder:text-neutral-500"
            />
          </label>
        )}

        <div className="grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] items-start gap-3">
          {workspaces.map((ws) => (
            <WorkspaceEntryRow
              key={ws.id}
              workspace={ws}
              filter={filter}
              onOpenRepo={openPath}
              onRename={(name) => renameWorkspace(ws.id, name)}
              onSetIgnoredPaths={(paths) => setIgnoredPaths(ws.id, paths)}
              onRemove={() => removeWorkspace(ws.id)}
            />
          ))}
        </div>
        {workspaces.length === 0 && !pendingWorkspace && (
          <p className="text-sm text-neutral-500">No workspace added yet.</p>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        onClick={handleOpenOther}
        className="text-sm text-neutral-400 underline hover:text-neutral-200"
      >
        Open another repository
      </button>
    </main>
  );
}
