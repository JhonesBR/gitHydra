import { Plus, Settings, X } from "lucide-react";
import { ScrollStrip } from "@/components/ScrollStrip";
import { WindowControls } from "@/components/WindowControls";
import { ProfileSelector } from "@/features/profiles/ProfileSelector";
import { basename } from "@/lib/path";
import { closeRepository } from "./api";
import type { Tab } from "./store";
import { useTabsStore } from "./store";

export function TabBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const openNewTab = useTabsStore((s) => s.openNewTab);
  const closeTab = useTabsStore((s) => s.closeTab);
  const setActiveTab = useTabsStore((s) => s.setActiveTab);

  const handleClose = (tab: Tab, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tab.repo) closeRepository(tab.repo.repoId).catch(() => {});
    closeTab(tab.id);
  };

  return (
    // Doubles as the window's title bar (native decorations are off): empty
    // parts of it drag the window, double-click maximizes.
    <div
      data-tauri-drag-region
      className="flex h-9 shrink-0 select-none items-center gap-1 border-b border-neutral-800 bg-neutral-900 px-2"
    >
      <ScrollStrip activeKey={activeTabId}>
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              data-active={tab.id === activeTabId ? "" : undefined}
              className={`flex h-7 shrink-0 items-center gap-1.5 rounded px-2.5 text-xs ${
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
        </div>
      </ScrollStrip>
      <button
        onClick={openNewTab}
        title="New tab (Ctrl+T)"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
      >
        <Plus size={14} />
      </button>
      {/* Free space between the tabs and the controls, always draggable. */}
      <div data-tauri-drag-region className="h-full min-w-2 flex-1" />
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={onOpenSettings}
          title="Settings (Ctrl+.)"
          className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          <Settings size={16} />
        </button>
        <ProfileSelector />
        <WindowControls />
      </div>
    </div>
  );
}
