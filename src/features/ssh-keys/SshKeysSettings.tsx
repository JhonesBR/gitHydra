import { X } from "lucide-react";
import { Select } from "@/components/Select";
import { INHERIT, keyName, keyOptions } from "./settings";
import { useSshKeyList, useSshKeySettings } from "./useSshKeys";

export function SshKeysSettings() {
  const keys = useSshKeyList();
  const { settings, setDefaultKey, setOverride } = useSshKeySettings();
  const overrides = Object.entries(settings.overrides).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="mb-1 text-sm font-semibold text-neutral-200">Default SSH key</h2>
        <p className="mb-2 text-xs text-neutral-500">
          Used for every repository without its own key (set in a workspace's edit dialog or next to a repo's
          Fetch/Push). ssh-agent is always tried first. Passphrases are asked only when you fetch or push, never
          for background fetches.
        </p>
        <Select
          value={settings.defaultKey ?? INHERIT}
          options={keyOptions(keys, settings.defaultKey, "OpenSSH defaults (id_ed25519, id_rsa)")}
          onChange={(v) => setDefaultKey(v || null)}
        />
        {keys.length === 0 && <p className="mt-2 text-xs text-neutral-500">No keys found in ~/.ssh.</p>}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-200">Workspace and repository keys</h2>
        {overrides.length === 0 ? (
          <p className="text-xs text-neutral-500">None yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-800 rounded border border-neutral-800">
            {overrides.map(([dir, key]) => (
              <li key={dir} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                <span className="min-w-0 flex-1 truncate text-neutral-300" title={dir}>
                  {dir}
                </span>
                <span className="shrink-0 text-neutral-500">{keyName(key)}</span>
                <button
                  onClick={() => setOverride(dir, null)}
                  title="Use the default key"
                  className="shrink-0 rounded p-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
