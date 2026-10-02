import { AI_MODELS, PROVIDER_LABELS } from "./models";
import { useAiSettings } from "./useAiSettings";
import type { AiProvider } from "./types";

const PROVIDERS: AiProvider[] = ["openai", "google", "anthropic"];

export function AiSettings() {
  const { settings, setApiKey, setProvider, updateSettings } = useAiSettings();

  return (
    <div className="space-y-5">
      <div>
        <h2 className="mb-3 text-sm font-semibold text-neutral-200">Provider</h2>
        <div className="flex gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p}
              onClick={() => setProvider(p)}
              className={`rounded border px-3 py-1.5 text-sm ${
                p === settings.provider
                  ? "border-emerald-600 text-emerald-400"
                  : "border-neutral-700 text-neutral-400 hover:bg-neutral-900"
              }`}
            >
              {PROVIDER_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-200">API Key ({PROVIDER_LABELS[settings.provider]})</h2>
        <label className="block text-xs text-neutral-500">
          {PROVIDER_LABELS[settings.provider]} API key
          <input
            type="password"
            value={settings.apiKeys[settings.provider]}
            onChange={(e) => setApiKey(settings.provider, e.currentTarget.value)}
            placeholder="Not set"
            className="mt-0.5 w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
          />
        </label>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-200">Commit Message Generation</h2>
        <label className="block text-xs text-neutral-500">
          Model
          <select
            value={settings.commitMessageModel}
            onChange={(e) => updateSettings({ commitMessageModel: e.currentTarget.value })}
            style={{ colorScheme: "dark" }}
            className="mt-0.5 w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
          >
            {AI_MODELS[settings.provider].map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.recommended ? " (Recommended)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-neutral-500">
          Custom Instructions
          <textarea
            value={settings.commitMessageCustomInstructions}
            onChange={(e) => updateSettings({ commitMessageCustomInstructions: e.currentTarget.value })}
            rows={4}
            placeholder="Optional. Takes priority over the default prompt where it conflicts."
            className="mt-0.5 w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
          />
        </label>
      </div>
    </div>
  );
}
