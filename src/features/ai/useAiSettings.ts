import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getConfig, setConfig } from "@/lib/config-store";
import { defaultModelFor } from "./models";
import type { AiSettings } from "./types";

const AI_SETTINGS_KEY = ["aiSettings"] as const;

const DEFAULT_SETTINGS: AiSettings = {
  provider: "openai",
  apiKeys: { openai: "", anthropic: "", google: "" },
  commitMessageModel: defaultModelFor("openai"),
  commitMessageCustomInstructions: "",
};

export function useAiSettings() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: AI_SETTINGS_KEY,
    queryFn: () => getConfig<AiSettings>("aiSettings", DEFAULT_SETTINGS),
  });

  const settings = data ?? DEFAULT_SETTINGS;

  // See useIntegrationsSettings.ts: update the cache synchronously so
  // controlled inputs track each keystroke, persist to disk in the background.
  const updateSettings = (patch: Partial<AiSettings>) => {
    const next = { ...settings, ...patch };
    queryClient.setQueryData(AI_SETTINGS_KEY, next);
    setConfig("aiSettings", next);
  };

  const setApiKey = (provider: AiSettings["provider"], key: string) =>
    updateSettings({ apiKeys: { ...settings.apiKeys, [provider]: key } });

  const setProvider = (provider: AiSettings["provider"]) =>
    updateSettings({ provider, commitMessageModel: defaultModelFor(provider) });

  return {
    settingsLoaded: data !== undefined,
    settings,
    updateSettings,
    setApiKey,
    setProvider,
  };
}
