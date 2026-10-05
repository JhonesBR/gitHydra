import { Plus, Settings, X } from "lucide-react";
import { ProfileSelector } from "@/features/profiles/ProfileSelector";
import { basename } from "@/lib/path";
import { closeRepository } from "./api";
import type { Tab } from "./store";
import { useTabsStore } from "./store";

export function TabBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const addTab = useTabsStore((s) => s.addTab);
  const closeTab = useTabsStore((s) => s.closeTab);
  const setActiveTab = useTabsStore((s) => s.setActiveTab);

  const handleClose = (tab: Tab, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tab.repo) closeRepository(tab.repo.repoId).catch(() => {});
    closeTab(tab.id);
  };

  const handleAddTab = () => {
    const openWorkspace = tabs.find((t) => t.repo === null && t.path === null);
    if (openWorkspace) {
      setActiveTab(openWorkspace.id);
    } else {
      addTab();
    }
  };

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-neutral-800 bg-neutral-900 px-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`flex h-7 items-center gap-1.5 rounded px-2.5 text-xs ${
            tab.id === activeTabId
              ? "bg-neutral-800 text-neutral-100"
              : "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200"
          }`}
        >
          <span className="max-w-[160px] truncate">
            {tab.path ? basename(tab.path) : "Workspace"}
          </span>
          <X
            size={13}
            onClick={(e) => handleClose(tab, e)}
            className="shrink-0 rounded hover:bg-neutral-700"
          />
        </button>
      ))}
      <button
        onClick={handleAddTab}
        title="New tab"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
      >
        <Plus size={14} />
      </button>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <button
          onClick={onOpenSettings}
          title="Settings (Ctrl+.)"
          className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          <Settings size={16} />
        </button>
        <ProfileSelector />
      </div>
    </div>
  );
}
