import { Trash2 } from "lucide-react";
import { useProfiles } from "./useProfiles";

export function ProfilesSettings() {
  const { profiles, activeProfile, setActiveProfileId, addProfile, updateProfile, removeProfile } =
    useProfiles();

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-neutral-200">Commit Profiles</h2>
      <div className="space-y-3">
        {profiles.map((p) => {
          const isActive = p.id === activeProfile?.id;
          return (
            <div
              key={p.id}
              className={`rounded border p-3 ${isActive ? "border-emerald-600" : "border-neutral-700"}`}
            >
              <div className="mb-2 flex items-center justify-between">
                <button
                  onClick={() => setActiveProfileId(p.id)}
                  disabled={isActive}
                  className={`text-xs ${
                    isActive ? "text-emerald-400" : "text-neutral-500 hover:text-neutral-300"
                  }`}
                >
                  {isActive ? "Active" : "Set active"}
                </button>
                <button
                  onClick={() => removeProfile(p.id)}
                  disabled={profiles.length <= 1}
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
                    value={p.label}
                    onChange={(e) => updateProfile(p.id, { label: e.currentTarget.value })}
                    className="mt-0.5 w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
                  />
                </label>
                <label className="block text-xs text-neutral-500">
                  Git name
                  <input
                    value={p.name}
                    onChange={(e) => updateProfile(p.id, { name: e.currentTarget.value })}
                    className="mt-0.5 w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
                  />
                </label>
                <label className="block text-xs text-neutral-500">
                  Git email
                  <input
                    value={p.email}
                    onChange={(e) => updateProfile(p.id, { email: e.currentTarget.value })}
                    className="mt-0.5 w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
                  />
                </label>
              </div>
            </div>
          );
        })}
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
