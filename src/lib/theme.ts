export const THEMES = [
  { id: "dark", label: "Dark" },
  { id: "tokyo", label: "Tokyo Night" },
  { id: "dracula", label: "Dracula" },
  { id: "one-dark", label: "One Dark" },
  { id: "nord", label: "Nord" },
  { id: "gruvbox", label: "Gruvbox Dark" },
  { id: "solarized", label: "Solarized Dark" },
  { id: "catppuccin", label: "Catppuccin Mocha" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
