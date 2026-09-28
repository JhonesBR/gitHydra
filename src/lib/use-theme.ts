import { useEffect } from "react";
import { usePersistedValue } from "./use-persisted-config";
import type { ThemeId } from "./theme";

export function useTheme() {
  const [theme, setTheme] = usePersistedValue<ThemeId>("ui.theme", "dark");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return [theme, setTheme] as const;
}
