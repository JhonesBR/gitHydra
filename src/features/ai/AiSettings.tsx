import { Select } from "@/components/Select";
import { useLocalText } from "@/lib/use-local-text";
import { AI_MODELS, PROVIDER_LABELS } from "./models";
import { useAiSettings } from "./useAiSettings";
import type { AiProvider } from "./types";

const PROVIDERS: AiProvider[] = ["openai", "google", "anthropic"];

export function AiSettings() {
  const { settings, setApiKey, setProvider, updateSettings } = useAiSettings();
  const [apiKey, setApiKeyLocal] = useLocalText(settings.apiKeys[settings.provider], (v) =>
    setApiKey(settings.provider, v),
  );
  const [customInstructions, setCustomInstructions] = useLocalText(
    settings.commitMessageCustomInstructions,
    (v) => updateSettings({ commitMessageCustomInstructions: v }),
  );

  const [composeInstructions, setComposeInstructions] = useLocalText(
    settings.composeCustomInstructions,
    (v) => updateSettings({ composeCustomInstructions: v }),
  );

  const [conflictInstructions, setConflictInstructions] = useLocalText(
    settings.conflictCustomInstructions,
    (v) => updateSettings({ conflictCustomInstructions: v }),
  );

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
            value={apiKey}
            onChange={(e) => setApiKeyLocal(e.currentTarget.value)}
            placeholder="Not set"
            className="mt-0.5 w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
          />
        </label>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-200">Commit Message Generation</h2>
        <div className="text-xs text-neutral-500">
          Model
          <div className="mt-0.5">
            <Select
              value={settings.commitMessageModel}
              onChange={(v) => updateSettings({ commitMessageModel: v })}
              options={AI_MODELS[settings.provider].map((m) => ({
                value: m.id,
                label: m.label + (m.recommended ? " (Recommended)" : ""),
              }))}
            />
          </div>
        </div>
        <label className="block text-xs text-neutral-500">
          Custom Instructions
          <textarea
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.currentTarget.value)}
            rows={4}
            placeholder="Optional. Takes priority over the default prompt where it conflicts."
            className="mt-0.5 w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
          />
        </label>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-200">Compose Commits with AI</h2>
        <p className="text-xs text-neutral-500">
          Splits the staged files into atomic, cherry-pickable commits (one per feature), using the model above
          and the commit message rules.
        </p>
        <label className="block text-xs text-neutral-500">
          Custom Instructions
          <textarea
            value={composeInstructions}
            onChange={(e) => setComposeInstructions(e.currentTarget.value)}
            rows={4}
            placeholder="Optional. E.g. 'always put tests in their own commit'. Takes priority over the default prompt where it conflicts."
            className="mt-0.5 w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
          />
        </label>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-200">Resolve Conflicts with AI</h2>
        <p className="text-xs text-neutral-500">
          The conflict editor can fill the output with a merge proposed by the model above. You review it before
          saving.
        </p>
        <label className="block text-xs text-neutral-500">
          Custom Instructions
          <textarea
            value={conflictInstructions}
            onChange={(e) => setConflictInstructions(e.currentTarget.value)}
            rows={3}
            placeholder="Optional. E.g. 'prefer the incoming change for lockfiles'."
            className="mt-0.5 w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
          />
        </label>
      </div>
    </div>
  );
}
