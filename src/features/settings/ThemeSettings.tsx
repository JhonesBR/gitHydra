import { Check } from "lucide-react";
import { THEMES } from "@/lib/theme";
import { useTheme } from "@/lib/use-theme";

export function ThemeSettings() {
  const [theme, setTheme] = useTheme();

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-neutral-200">Theme</h2>
      <div className="grid grid-cols-2 gap-3">
        {THEMES.map((t) => (
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
