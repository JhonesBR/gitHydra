import { Check, Moon, Sun } from "lucide-react";
import { THEMES, themeMode, type ThemeMode } from "@/lib/theme";
import { useTheme } from "@/lib/use-theme";

const MODES: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: "dark", label: "Dark", icon: Moon },
  { id: "light", label: "Light", icon: Sun },
];

export function ThemeSettings() {
  const [theme, setTheme] = useTheme();
  const mode = themeMode(theme);

  const selectMode = (next: ThemeMode) => {
    if (next === mode) return;
    const first = THEMES.find((t) => t.mode === next);
    if (first) setTheme(first.id);
  };

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-neutral-200">Appearance</h2>
      <div className="mb-5 inline-flex rounded border border-neutral-700 p-0.5">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => selectMode(m.id)}
            className={`flex items-center gap-1.5 rounded px-3 py-1 text-sm ${
              mode === m.id ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <m.icon size={14} /> {m.label}
          </button>
        ))}
      </div>

      <h2 className="mb-3 text-sm font-semibold text-neutral-200">Theme</h2>
      <div className="grid grid-cols-2 gap-3">
        {THEMES.filter((t) => t.mode === mode).map((t) => (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            className={`flex items-center justify-between rounded border px-3 py-2 text-sm ${
              theme === t.id
                ? "border-blue-500 bg-neutral-800 text-neutral-100"
                : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
            }`}
          >
            {t.label}
            {theme === t.id && <Check size={14} />}
          </button>
        ))}
      </div>
    </div>
  );
}
