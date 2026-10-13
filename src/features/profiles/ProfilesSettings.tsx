import { Trash2 } from "lucide-react";
import { useLocalText } from "@/lib/use-local-text";
import type { Profile } from "./types";
import { useProfiles } from "./useProfiles";

function ProfileRow({
  profile,
  isActive,
  canRemove,
  onSetActive,
  onUpdate,
  onRemove,
}: {
  profile: Profile;
  isActive: boolean;
  canRemove: boolean;
  onSetActive: () => void;
  onUpdate: (patch: Partial<Omit<Profile, "id">>) => void;
  onRemove: () => void;
}) {
  const [label, setLabel] = useLocalText(profile.label, (v) => onUpdate({ label: v }));
  const [name, setName] = useLocalText(profile.name, (v) => onUpdate({ name: v }));
  const [email, setEmail] = useLocalText(profile.email, (v) => onUpdate({ email: v }));

  return (
    <div className={`rounded border p-3 ${isActive ? "border-emerald-600" : "border-neutral-700"}`}>
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={onSetActive}
          disabled={isActive}
          className={`text-xs ${isActive ? "text-emerald-400" : "text-neutral-500 hover:text-neutral-300"}`}
        >
          {isActive ? "Active" : "Set active"}
        </button>
        <button
          onClick={onRemove}
          disabled={!canRemove}
          title="Delete profile"
          className="text-neutral-500 hover:text-red-400 disabled:opacity-30"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <div className="space-y-2">
        <label className="block text-xs text-neutral-500">
          Profile name
          <input
            value={label}
            onChange={(e) => setLabel(e.currentTarget.value)}
            className="mt-0.5 w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
          />
        </label>
        <label className="block text-xs text-neutral-500">
          Git name
          <input
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            className="mt-0.5 w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
          />
        </label>
        <label className="block text-xs text-neutral-500">
          Git email
          <input
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            className="mt-0.5 w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
          />
        </label>
      </div>
    </div>
  );
}

export function ProfilesSettings() {
  const { profiles, activeProfile, setActiveProfileId, addProfile, updateProfile, removeProfile } =
    useProfiles();

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-neutral-200">Commit Profiles</h2>
      <div className="space-y-3">
        {profiles.map((p) => (
          <ProfileRow
            key={p.id}
            profile={p}
            isActive={p.id === activeProfile?.id}
            canRemove={profiles.length > 1}
            onSetActive={() => setActiveProfileId(p.id)}
            onUpdate={(patch) => updateProfile(p.id, patch)}
            onRemove={() => removeProfile(p.id)}
          />
        ))}
      </div>
      <button
        onClick={() => addProfile({ label: "New profile", name: "", email: "" })}
        className="mt-3 rounded bg-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-600"
      >
        + Add profile
      </button>
    </div>
  );
}
