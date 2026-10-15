import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config-store", () => ({ getConfig: vi.fn(), setConfig: vi.fn() }));

import { tabsToLeft, tabsToRight, useTabsStore } from "./store";

const ids = () => useTabsStore.getState().tabs.map((t) => t.path);
const idOf = (path: string) => useTabsStore.getState().tabs.find((t) => t.path === path)!.id;

beforeEach(() => {
  useTabsStore.getState().restoreTabs(["/a", "/b", "/c", "/d"], 0);
});

describe("togglePinTab", () => {
  it("moves a pinned tab to the end of the pinned group", () => {
    const { togglePinTab } = useTabsStore.getState();
    togglePinTab(idOf("/c"));
    expect(ids()).toEqual(["/c", "/a", "/b", "/d"]);
    togglePinTab(idOf("/d"));
    expect(ids()).toEqual(["/c", "/d", "/a", "/b"]);
  });

  it("moves an unpinned tab right after the pinned group", () => {
    const { togglePinTab } = useTabsStore.getState();
    togglePinTab(idOf("/c"));
    togglePinTab(idOf("/d"));
    togglePinTab(idOf("/c"));
    expect(ids()).toEqual(["/d", "/c", "/a", "/b"]);
    expect(useTabsStore.getState().tabs.map((t) => t.pinned)).toEqual([true, false, false, false]);
  });
});

describe("tabsToLeft / tabsToRight", () => {
  it("skips pinned tabs", () => {
    useTabsStore.getState().togglePinTab(idOf("/a"));
    const { tabs } = useTabsStore.getState();
    expect(tabsToLeft(tabs, idOf("/c")).map((t) => t.path)).toEqual(["/b"]);
    expect(tabsToRight(tabs, idOf("/b")).map((t) => t.path)).toEqual(["/c", "/d"]);
    expect(tabsToRight(tabs, idOf("/d"))).toEqual([]);
  });
});

describe("closeTabs", () => {
  it("activates the fallback tab when the active one is closed", () => {
    const s = useTabsStore.getState();
    s.setActiveTab(idOf("/a"));
    s.closeTabs([idOf("/a"), idOf("/b")], idOf("/c"));
    expect(ids()).toEqual(["/c", "/d"]);
    expect(useTabsStore.getState().activeTabId).toBe(idOf("/c"));
  });

  it("keeps the active tab when it survives", () => {
    const s = useTabsStore.getState();
    s.setActiveTab(idOf("/d"));
    s.closeTabs([idOf("/a")]);
    expect(useTabsStore.getState().activeTabId).toBe(idOf("/d"));
  });

  it("leaves a blank tab when everything is closed", () => {
    const { tabs, closeTabs } = useTabsStore.getState();
    closeTabs(tabs.map((t) => t.id));
    expect(ids()).toEqual([null]);
  });
});

describe("restoreTabs", () => {
  it("restores pinned tabs at the front, keeping the active one", () => {
    useTabsStore.getState().restoreTabs(["/a", "/b", "/c"], 1, ["/c"]);
    expect(ids()).toEqual(["/c", "/a", "/b"]);
    expect(useTabsStore.getState().activeTabId).toBe(idOf("/b"));
  });
});
