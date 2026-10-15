import { Pin, Plus, Settings, X } from "lucide-react";
import { Fragment } from "react";
import { type ContextMenuItem, useContextMenu } from "@/components/ContextMenu";
import { ScrollStrip } from "@/components/ScrollStrip";
import { WindowControls } from "@/components/WindowControls";
import { ProfileSelector } from "@/features/profiles/ProfileSelector";
import { basename } from "@/lib/path";
import { closeRepository } from "./api";
import type { Tab } from "./store";
import { tabsToLeft, tabsToRight, useTabsStore } from "./store";

export function TabBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const openNewTab = useTabsStore((s) => s.openNewTab);
  const closeTabs = useTabsStore((s) => s.closeTabs);
  const togglePinTab = useTabsStore((s) => s.togglePinTab);
  const setActiveTab = useTabsStore((s) => s.setActiveTab);
  const { open: openMenu, menu } = useContextMenu();

  // `keep`: the tab that takes over if the active one is among those closed.
  const closeWithRepos = (closing: Tab[], keep?: string) => {
    for (const tab of closing) if (tab.repo) closeRepository(tab.repo.repoId).catch(() => {});
    closeTabs(closing.map((t) => t.id), keep);
  };

  const handleClose = (tab: Tab, e: React.MouseEvent) => {
    e.stopPropagation();
    closeWithRepos([tab]);
  };

  const tabMenuItems = (tab: Tab): ContextMenuItem[] => {
    const left = tabsToLeft(tabs, tab.id);
    const right = tabsToRight(tabs, tab.id);
    return [
      { label: tab.pinned ? "Unpin tab" : "Pin tab", onClick: () => togglePinTab(tab.id) },
      { label: "Close tab", onClick: () => closeWithRepos([tab]) },
      { label: "Close tabs to the left", onClick: () => closeWithRepos(left, tab.id), disabled: !left.length },
      { label: "Close tabs to the right", onClick: () => closeWithRepos(right, tab.id), disabled: !right.length },
    ];
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
          {tabs.map((tab, i) => (
            <Fragment key={tab.id}>
              <button
                onClick={() => setActiveTab(tab.id)}
                onContextMenu={(e) => openMenu(e, tabMenuItems(tab))}
                data-active={tab.id === activeTabId ? "" : undefined}
                title={tab.path ?? undefined}
                className={`flex h-7 shrink-0 items-center gap-1.5 rounded px-2.5 text-xs ${
                  tab.id === activeTabId
                    ? "bg-neutral-800 text-neutral-100"
                    : "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200"
                }`}
              >
                {tab.pinned && <Pin size={11} className="shrink-0 opacity-70" />}
                <span className="max-w-[160px] truncate">
                  {tab.path ? basename(tab.path) : "Workspace"}
                </span>
                {/* Pinned tabs close only via the context menu. */}
                {!tab.pinned && (
                  <X
                    size={13}
                    onClick={(e) => handleClose(tab, e)}
                    className="shrink-0 rounded hover:bg-neutral-700"
                  />
                )}
              </button>
              {tab.pinned && tabs[i + 1] && !tabs[i + 1].pinned && (
                <div className="mx-0.5 h-4 w-px shrink-0 bg-neutral-700" />
              )}
            </Fragment>
          ))}
        </div>
      </ScrollStrip>
      {menu}
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
