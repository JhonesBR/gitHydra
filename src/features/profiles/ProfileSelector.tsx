import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useEffectiveProfile } from "./useEffectiveProfile";
import { useProfiles } from "./useProfiles";

export function ProfileSelector({ repoPath }: { repoPath: string | null }) {
  const { profiles, setActiveProfileId } = useProfiles();
  const { profile: activeProfile, workspace } = useEffectiveProfile(repoPath);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (!activeProfile) return null;

  if (workspace) {
    return (
      <span title={`Profile set by workspace "${workspace.name}"`} className="max-w-[14rem] truncate px-1 text-xs text-neutral-400">
        {activeProfile.label} <span className="text-neutral-500">· workspace {workspace.name}</span>
      </span>
    );
  }

  if (profiles.length <= 1) {
    return (
      <span title="Commit profile" className="px-1 text-xs text-neutral-400">
        {activeProfile.label}
      </span>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Commit profile"
        className="flex items-center gap-1 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
      >
        <span className="max-w-[10rem] truncate">{activeProfile.label}</span>
        <ChevronDown size={12} className="shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded border border-neutral-700 bg-neutral-900 py-1 shadow-xl">
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setActiveProfileId(p.id);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-800"
            >
              <span className="truncate">{p.label}</span>
              {p.id === activeProfile.id && (
                <Check size={12} className="shrink-0 text-emerald-400" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
