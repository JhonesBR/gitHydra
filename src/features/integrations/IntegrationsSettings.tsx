import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { useLocalText } from "@/lib/use-local-text";
import { gitLabTokenUrl } from "./provider";
import type { GitLabInstance } from "./types";
import { useIntegrationsSettings } from "./useIntegrationsSettings";

/** Label row above a token input, with a direct link to where the token is created. */
export function TokenLabel({ url }: { url: string | null }) {
  return (
    <span className="flex items-center justify-between gap-2">
      Personal access token
      <button
        type="button"
        disabled={!url}
        onClick={() => url && openUrl(url)}
        title={url ?? "Set the base URL first"}
        className="flex items-center gap-1 text-blue-500 hover:underline disabled:cursor-not-allowed disabled:text-neutral-600 disabled:no-underline"
      >
        Generate token <ExternalLink size={11} />
      </button>
    </span>
  );
}

function GitLabInstanceRow({
  instance,
  onUpdate,
  onRemove,
}: {
  instance: GitLabInstance;
  onUpdate: (patch: Partial<GitLabInstance>) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useLocalText(instance.name, (v) => onUpdate({ name: v }));
  const [baseUrl, setBaseUrl] = useLocalText(instance.baseUrl, (v) => onUpdate({ baseUrl: v }));
  const [token, setToken] = useLocalText(instance.token, (v) => onUpdate({ token: v }));

  return (
    <div className="space-y-2 rounded border border-neutral-800 p-2">
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Name (e.g. Internal GitLab)"
          className="min-w-0 flex-1 rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
        />
        <button
          onClick={onRemove}
          title="Remove"
          className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-red-400"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <label className="block text-xs text-neutral-500">
        Base URL
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.currentTarget.value)}
          placeholder="https://gitlab.company.com"
          className="mt-0.5 w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
        />
      </label>
      <label className="block text-xs text-neutral-500">
        <TokenLabel url={gitLabTokenUrl(baseUrl)} />
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.currentTarget.value)}
          placeholder="Not set"
          className="mt-0.5 w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
        />
      </label>
    </div>
  );
}

export function IntegrationsSettings() {
  const { settings, setGitLabInstances } = useIntegrationsSettings();
  const instances = settings.gitlab.instances;

  const updateInstance = (id: string, patch: Partial<GitLabInstance>) =>
    setGitLabInstances(instances.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const addInstance = () =>
    setGitLabInstances([...instances, { id: crypto.randomUUID(), name: "", baseUrl: "", token: "" }]);

  const removeInstance = (id: string) => setGitLabInstances(instances.filter((i) => i.id !== id));

  return (
    <div className="space-y-3">
      <details open className="rounded border border-neutral-800">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-neutral-200">
          GitLab
        </summary>
        <div className="space-y-3 border-t border-neutral-800 p-3">
          <p className="text-xs text-neutral-500">
            Self-managed GitLab instances, matched to a repository by the hostname of its{" "}
            <code>origin</code> remote.
          </p>
          {instances.map((instance) => (
            <GitLabInstanceRow
              key={instance.id}
              instance={instance}
              onUpdate={(patch) => updateInstance(instance.id, patch)}
              onRemove={() => removeInstance(instance.id)}
            />
          ))}
          <button
            onClick={addInstance}
            className="flex items-center gap-1.5 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900"
          >
            <Plus size={12} /> Add GitLab instance
          </button>
        </div>
      </details>
    </div>
  );
}
