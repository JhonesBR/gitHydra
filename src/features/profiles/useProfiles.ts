import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getConfig, setConfig } from "@/lib/config-store";
import type { Profile } from "./types";

const PROFILES_KEY = ["profiles"] as const;
const ACTIVE_PROFILE_KEY = ["activeProfileId"] as const;

export function useProfiles() {
  const queryClient = useQueryClient();

  const { data: profiles } = useQuery({
    queryKey: PROFILES_KEY,
    queryFn: () => getConfig<Profile[]>("profiles", []),
  });
  const { data: activeProfileId } = useQuery({
    queryKey: ACTIVE_PROFILE_KEY,
    queryFn: () => getConfig<string | null>("activeProfileId", null),
  });

  const persistProfiles = async (next: Profile[]) => {
    await setConfig("profiles", next);
    queryClient.invalidateQueries({ queryKey: PROFILES_KEY });
  };
  const persistActiveProfileId = async (id: string) => {
    await setConfig("activeProfileId", id);
    queryClient.invalidateQueries({ queryKey: ACTIVE_PROFILE_KEY });
  };

  const safeProfiles = profiles ?? [];
  const activeProfile = safeProfiles.find((p) => p.id === activeProfileId) ?? safeProfiles[0] ?? null;

  const addProfile = (profile: Omit<Profile, "id">) =>
    persistProfiles([...safeProfiles, { ...profile, id: crypto.randomUUID() }]);

  const updateProfile = (id: string, patch: Partial<Omit<Profile, "id">>) =>
    persistProfiles(safeProfiles.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const removeProfile = (id: string) => {
    const next = safeProfiles.filter((p) => p.id !== id);
    persistProfiles(next);
    if (activeProfileId === id && next.length > 0) persistActiveProfileId(next[0].id);
  };

  return {
    profilesLoaded: profiles !== undefined,
    profiles: safeProfiles,
    activeProfile,
    setActiveProfileId: persistActiveProfileId,
    addProfile,
    updateProfile,
    removeProfile,
  };
}
