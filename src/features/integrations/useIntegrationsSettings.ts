import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getConfig, setConfig } from "@/lib/config-store";
import type { GitLabInstance, IntegrationsSettings } from "./types";

const INTEGRATIONS_SETTINGS_KEY = ["integrationsSettings"] as const;

const DEFAULT_SETTINGS: IntegrationsSettings = {
  gitlab: { instances: [] },
};

export function useIntegrationsSettings() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: INTEGRATIONS_SETTINGS_KEY,
    queryFn: () => getConfig<IntegrationsSettings>("integrationsSettings", DEFAULT_SETTINGS),
  });

  const settings = data ?? DEFAULT_SETTINGS;

  // Writes the new value into the query cache immediately (so controlled
  // inputs reflect each keystroke in the same tick) and persists to disk in
  // the background — awaiting the round-trip before updating the cache would
  // lag the visible value behind by one write+refetch per keystroke, which
  // reads as the cursor jumping to the end on fast typing.
  const updateSettings = (patch: Partial<IntegrationsSettings>) => {
    const next = { ...settings, ...patch };
    queryClient.setQueryData(INTEGRATIONS_SETTINGS_KEY, next);
    setConfig("integrationsSettings", next);
  };

  const setGitLabInstances = (instances: GitLabInstance[]) => updateSettings({ gitlab: { instances } });

  return {
    settingsLoaded: data !== undefined,
    settings,
    setGitLabInstances,
  };
}
