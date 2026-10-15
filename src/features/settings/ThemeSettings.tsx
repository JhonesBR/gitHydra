import { FontSettings } from "./FontSettings";
import { THEMES, type ThemeId } from "@/lib/theme";
import { useTheme } from "@/lib/use-theme";

/** A tiny mock window painted in `theme`'s own colors (see `.theme-preview`
 * in App.css): sidebar strip, a few text lines and an accent bar. */
function ThemePreview({ theme }: { theme: ThemeId }) {
  return (
    <div
      data-theme={theme}
      className="theme-preview flex h-14 overflow-hidden rounded border border-neutral-700 bg-neutral-950"
    >
      <div className="w-1/4 shrink-0 bg-neutral-900" />
      <div className="flex flex-1 flex-col justify-center gap-1.5 px-3">
        <div className="h-1 w-4/5 rounded-full bg-neutral-400" />
        <div className="h-1 w-3/5 rounded-full bg-neutral-600" />
        <div className="h-1 w-2/3 rounded-full bg-neutral-600" />
        <div className="mt-0.5 h-1 w-1/4 rounded-full bg-blue-500" />
      </div>
    </div>
  );
}

export function ThemeSettings() {
  const [theme, setTheme] = useTheme();

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-neutral-200">Built-in Themes</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3">
        {THEMES.map((t) => {
          const selected = theme === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              aria-pressed={selected}
              className={`flex flex-col gap-2 rounded-md border p-2 text-sm transition-colors ${
                selected
                  ? "border-blue-500 bg-neutral-800 text-blue-500 ring-1 ring-blue-500"
                  : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-600 hover:bg-neutral-800"
              }`}
            >
              <ThemePreview theme={t.id} />
              <span className="truncate">{t.label}</span>
            </button>
          );
        })}
      </div>
      <FontSettings />
    </div>
  );
}
