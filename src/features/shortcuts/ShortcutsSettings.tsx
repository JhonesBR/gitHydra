import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ACTIONS, bindingsFor, eventToBinding, findConflict, formatBinding, isUsableBinding } from "./shortcuts";
import { useShortcutOverrides } from "./useShortcuts";

/** Lists every action with its binding; used by the settings tab and the Ctrl+/ reference. */
export function ShortcutsList({ editable }: { editable: boolean }) {
  const { overrides, setBinding, reset } = useShortcutOverrides();
  const [recording, setRecording] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setRecording(null);
      const binding = eventToBinding(e);
      if (!binding) return;
      if (!isUsableBinding(binding)) return void toast.error("Use Ctrl/⌘ or Alt with a key (or a function key)");
      const conflict = findConflict(recording, binding, overrides);
      if (conflict) return void toast.error(`${formatBinding(binding)} is already used by "${conflict.label}"`);
      setBinding(recording, binding);
      setRecording(null);
    };
    // Capture phase: runs before the app's own shortcut listeners.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, overrides, setBinding]);

  return (
    <div className="space-y-4">
      {(["General", "Repository", "Editing"] as const).map((group) => (
        <div key={group}>
          <h3 className="mb-1 text-xs uppercase text-neutral-500">{group}</h3>
          <ul className="divide-y divide-neutral-800">
            {ACTIONS.filter((a) => a.group === group).map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-1.5 text-sm">
                <span className="flex-1 text-neutral-300">{a.label}</span>
                {editable ? (
                  <>
                    <button
                      onClick={() => setRecording(recording === a.id ? null : a.id)}
                      className="min-w-28 rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-200 hover:bg-neutral-700"
                    >
                      {recording === a.id
                        ? "Press keys… (Esc cancels)"
                        : bindingsFor(a.id, overrides).map((b) => formatBinding(b)).join(" / ")}
                    </button>
                    {overrides[a.id] && (
                      <button onClick={() => reset(a.id)} className="text-xs text-neutral-500 hover:text-neutral-200">
                        reset
                      </button>
                    )}
                  </>
                ) : (
                  <span className="flex gap-1">
                    {bindingsFor(a.id, overrides).map((b) => (
                      <kbd key={b} className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-xs text-neutral-200">
                        {formatBinding(b)}
                      </kbd>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function ShortcutsSettings() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-500">
        Click a shortcut, then press the new keys. Ctrl is ⌘ on macOS.
      </p>
      <ShortcutsList editable />
    </div>
  );
}
