import { useEffect } from "react";
import { usePersistedValue } from "./use-persisted-config";
import type { ThemeId } from "./theme";

export function useTheme() {
  const [theme, setTheme, loaded] = usePersistedValue<ThemeId>("ui.theme", "dark");

  useEffect(() => {
    if (!loaded) return;
    document.documentElement.dataset.theme = theme;
  }, [theme, loaded]);

  return [theme, setTheme] as const;
}
