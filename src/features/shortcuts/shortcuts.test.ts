import { describe, expect, it } from "vitest";
import { ACTIONS, bindingsFor, eventToBinding, findConflict, formatBinding, isUsableBinding, matches } from "./shortcuts";

const ev = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("eventToBinding / matches", () => {
  it("treats Ctrl and Meta as Mod and normalizes letters", () => {
    expect(eventToBinding(ev("p", { ctrlKey: true }))).toBe("Mod+P");
    expect(eventToBinding(ev("p", { metaKey: true }))).toBe("Mod+P");
    expect(eventToBinding(ev("Z", { ctrlKey: true, shiftKey: true }))).toBe("Mod+Shift+Z");
    expect(eventToBinding(ev(" ", { altKey: true }))).toBe("Alt+Space");
  });
  it("ignores bare modifiers", () => {
    expect(eventToBinding(ev("Control", { ctrlKey: true }))).toBeNull();
  });
  it("matches exactly, extra modifiers included", () => {
    expect(matches(ev("z", { ctrlKey: true }), "Mod+Z")).toBe(true);
    expect(matches(ev("Z", { ctrlKey: true, shiftKey: true }), "Mod+Z")).toBe(false);
  });
});

describe("bindings", () => {
  it("uses defaults until overridden, and an override replaces all of them", () => {
    expect(bindingsFor("redo", {})).toEqual(["Mod+Shift+Z", "Mod+Y"]);
    expect(bindingsFor("redo", { redo: "Alt+R" })).toEqual(["Alt+R"]);
  });
  it("finds conflicts with other actions only", () => {
    expect(findConflict("newTab", "Mod+P", {})?.id).toBe("searchRepos");
    expect(findConflict("searchRepos", "Mod+P", {})).toBeNull();
    expect(findConflict("newTab", "Mod+P", { searchRepos: "Mod+K" })).toBeNull();
  });
  it("has unique default bindings", () => {
    const all = ACTIONS.flatMap((a) => a.defaults);
    expect(new Set(all).size).toBe(all.length);
  });
  it("only allows bindings that can't be typed as text", () => {
    expect(isUsableBinding("Mod+K")).toBe(true);
    expect(isUsableBinding("F5")).toBe(true);
    expect(isUsableBinding("K")).toBe(false);
    expect(isUsableBinding("Shift+K")).toBe(false);
  });
  it("formats for the platform", () => {
    expect(formatBinding("Mod+Shift+Z", false)).toBe("Ctrl+Shift+Z");
    expect(formatBinding("Mod+Shift+Z", true)).toBe("⌘⇧Z");
  });
});
