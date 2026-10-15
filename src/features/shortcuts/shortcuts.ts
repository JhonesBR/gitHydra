/** Keyboard shortcuts as data: a binding is "Mod+Shift+Alt+Key" (Mod = Ctrl, or ⌘ on macOS). */

export type ShortcutAction = {
  id: string;
  label: string;
  group: "General" | "Repository" | "Editing";
  /** Every binding that triggers it until the user picks their own. */
  defaults: string[];
};

export const ACTIONS: ShortcutAction[] = [
  { id: "searchRepos", label: "Search repositories", group: "General", defaults: ["Mod+P"] },
  { id: "newTab", label: "New tab", group: "General", defaults: ["Mod+T"] },
  { id: "openSettings", label: "Open settings", group: "General", defaults: ["Mod+."] },
  { id: "toggleActivityLog", label: "Toggle activity logs", group: "General", defaults: ["Mod+L"] },
  { id: "showShortcuts", label: "Show keyboard shortcuts", group: "General", defaults: ["Mod+/"] },
  { id: "toggleTerminal", label: "Toggle terminal", group: "Repository", defaults: ["Mod+'"] },
  { id: "searchCommits", label: "Search commits", group: "Repository", defaults: ["Mod+F"] },
  { id: "undo", label: "Undo", group: "Editing", defaults: ["Mod+Z"] },
  { id: "redo", label: "Redo", group: "Editing", defaults: ["Mod+Shift+Z", "Mod+Y"] },
];

/** What the user changed: action id → its single replacement binding. */
export type Overrides = Record<string, string>;

type KeyEventLike = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean };

const MODIFIER_KEYS = new Set(["Control", "Meta", "Shift", "Alt", "AltGraph"]);

/** The binding an event would trigger, or null for a bare modifier press. */
export function eventToBinding(e: KeyEventLike): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const key = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [
    (e.ctrlKey || e.metaKey) && "Mod",
    e.shiftKey && "Shift",
    e.altKey && "Alt",
    key,
  ]
    .filter(Boolean)
    .join("+");
}

export const matches = (e: KeyEventLike, binding: string) => eventToBinding(e) === binding;

/** Whether a recorded binding is allowed: it needs a modifier (or be a function key), so typing never triggers it. */
export function isUsableBinding(binding: string): boolean {
  return /^(Mod|Alt)\+/.test(binding) || /^(Shift\+)?F\d{1,2}$/.test(binding);
}

export function bindingsFor(id: string, overrides: Overrides): string[] {
  if (overrides[id]) return [overrides[id]];
  return ACTIONS.find((a) => a.id === id)?.defaults ?? [];
}

/** Another action already using `binding`, if any. */
export function findConflict(id: string, binding: string, overrides: Overrides): ShortcutAction | null {
  return ACTIONS.find((a) => a.id !== id && bindingsFor(a.id, overrides).includes(binding)) ?? null;
}

export function formatBinding(binding: string, mac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "")): string {
  return binding
    .split("+")
    .map((part) => (part === "Mod" ? (mac ? "⌘" : "Ctrl") : part === "Alt" && mac ? "⌥" : part === "Shift" && mac ? "⇧" : part))
    .join(mac ? "" : "+");
}
