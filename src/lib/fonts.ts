import { useEffect } from "react";
import { create } from "zustand";
import { getConfig, setConfig } from "./config-store";

export type FontSettings = { textFamily: string; textSize: number; codeFamily: string; codeSize: number };

export const DEFAULT_FONTS: FontSettings = { textFamily: "", textSize: 16, codeFamily: "", codeSize: 12 };
const KEY = "ui.fonts";

type FontStore = { fonts: FontSettings; loaded: boolean; set: (f: Partial<FontSettings>) => void };

export const useFontStore = create<FontStore>((set, get) => ({
  fonts: DEFAULT_FONTS,
  loaded: false,
  set: (f) => {
    const fonts = { ...get().fonts, ...f };
    set({ fonts });
    setConfig(KEY, fonts);
  },
}));

getConfig<Partial<FontSettings>>(KEY, {}).then((saved) =>
  useFontStore.setState({ fonts: { ...DEFAULT_FONTS, ...saved }, loaded: true }),
);

/** A bare name becomes a quoted family; a list with commas is taken as a stack. */
const stack = (family: string, fallback: string) => {
  const f = family.trim();
  if (!f) return null;
  return `${f.includes(",") ? f : `"${f}"`}, ${fallback}`;
};

/** Mount once: mirrors the settings onto `<html>` as the CSS variables
 * Tailwind's `font-sans`/`font-mono` read, plus rem scale and code size. */
export function useApplyFonts() {
  const { fonts, loaded } = useFontStore();
  useEffect(() => {
    if (!loaded) return;
    const root = document.documentElement;
    const put = (name: string, v: string | null) => (v ? root.style.setProperty(name, v) : root.style.removeProperty(name));
    put("--font-sans", stack(fonts.textFamily, "ui-sans-serif, system-ui, sans-serif"));
    put("--font-mono", stack(fonts.codeFamily, "ui-monospace, monospace"));
    root.style.fontSize = fonts.textSize === DEFAULT_FONTS.textSize ? "" : `${fonts.textSize}px`;
    root.style.setProperty("--code-size", `${fonts.codeSize}px`);
    if (fonts.codeSize === DEFAULT_FONTS.codeSize) delete root.dataset.codeSize;
    else root.dataset.codeSize = "custom";
  }, [fonts, loaded]);
}
