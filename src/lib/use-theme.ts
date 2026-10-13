import { useEffect, useState } from "react";
import { usePersistedValue } from "./use-persisted-config";
import { themeMode, type ThemeId, type ThemeMode } from "./theme";

export function useTheme() {
  const [theme, setTheme, loaded] = usePersistedValue<ThemeId>("ui.theme", "dark");

  useEffect(() => {
    if (!loaded) return;
    const root = document.documentElement;
    const mode = themeMode(theme);
    root.dataset.theme = theme;
    root.dataset.mode = mode;
    // Native bits (scrollbars, form controls) follow the theme's brightness.
    root.style.colorScheme = mode;
  }, [theme, loaded]);

  return [theme, setTheme] as const;
}

/** The theme currently applied to `<html data-theme>`. Each `useTheme()` call
 * keeps its own state, so consumers that only need to *react* to a theme
 * change made elsewhere (Settings) observe the attribute instead. */
export function useAppliedTheme(): ThemeId {
  const read = () => (document.documentElement.dataset.theme ?? "dark") as ThemeId;
  const [theme, setTheme] = useState<ThemeId>(read);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

export const useThemeMode = (): ThemeMode => themeMode(useAppliedTheme());
