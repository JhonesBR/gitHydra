export type ThemeMode = "dark" | "light";

export const THEMES = [
  { id: "dark", label: "Dark", mode: "dark" },
  { id: "tokyo", label: "Tokyo Night", mode: "dark" },
  { id: "dracula", label: "Dracula", mode: "dark" },
  { id: "one-dark", label: "One Dark", mode: "dark" },
  { id: "nord", label: "Nord", mode: "dark" },
  { id: "gruvbox", label: "Gruvbox Dark", mode: "dark" },
  { id: "solarized", label: "Solarized Dark", mode: "dark" },
  { id: "catppuccin", label: "Catppuccin Mocha", mode: "dark" },
  { id: "rose-pine", label: "Rosé Pine", mode: "dark" },
  { id: "light", label: "Light", mode: "light" },
  { id: "catppuccin-latte", label: "Catppuccin Latte", mode: "light" },
  { id: "rose-pine-dawn", label: "Rosé Pine Dawn", mode: "light" },
  { id: "solarized-light", label: "Solarized Light", mode: "light" },
] as const satisfies readonly { id: string; label: string; mode: ThemeMode }[];

export type ThemeId = (typeof THEMES)[number]["id"];

export const themeMode = (id: ThemeId): ThemeMode => THEMES.find((t) => t.id === id)?.mode ?? "dark";
