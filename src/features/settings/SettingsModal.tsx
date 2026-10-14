import { Bot, KeyRound, Paintbrush, Plug, UserCircle, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { confirm } from "@/lib/confirm-store";
import { setConfig } from "@/lib/config-store";
import { useAppliedTheme, useTheme } from "@/lib/use-theme";
import { useAiSettings } from "@/features/ai/useAiSettings";
import { useIntegrationsSettings } from "@/features/integrations/useIntegrationsSettings";
import { useProfiles } from "@/features/profiles/useProfiles";
import { Modal } from "@/components/Modal";
import { AiSettings } from "@/features/ai/AiSettings";
import { IntegrationsSettings } from "@/features/integrations/IntegrationsSettings";
import { ProfilesSettings } from "@/features/profiles/ProfilesSettings";
import { SshKeysSettings } from "@/features/ssh-keys/SshKeysSettings";
import { useSshKeySettings } from "@/features/ssh-keys/useSshKeys";
import { ThemeSettings } from "./ThemeSettings";

const TABS = [
  { id: "ui" as const, label: "UI", icon: Paintbrush, Content: ThemeSettings },
  { id: "profiles" as const, label: "Profiles", icon: UserCircle, Content: ProfilesSettings },
  { id: "ssh" as const, label: "SSH Keys", icon: KeyRound, Content: SshKeysSettings },
  { id: "ai" as const, label: "AI Integration", icon: Bot, Content: AiSettings },
  { id: "integrations" as const, label: "Integrations", icon: Plug, Content: IntegrationsSettings },
];

// Tabs apply changes live (query cache + config file). Save keeps them; Cancel/close
// restores the snapshot taken when the modal opened. [query key, config key] pairs.
const SNAPSHOT_KEYS = [
  ["aiSettings", "aiSettings"],
  ["integrationsSettings", "integrationsSettings"],
  ["profiles", "profiles"],
  ["activeProfileId", "activeProfileId"],
  ["sshKeys", "sshKeys"],
] as const;

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  // Mounted here so every tab's data is in the cache (and loaded) from the start.
  const ai = useAiSettings();
  const integrations = useIntegrationsSettings();
  const profiles = useProfiles();
  const ssh = useSshKeySettings();
  const theme = useAppliedTheme();
  const [, setTheme] = useTheme();
  const loaded = ai.settingsLoaded && integrations.settingsLoaded && profiles.profilesLoaded && ssh.settingsLoaded;
  const current = JSON.stringify([
    ai.settings,
    integrations.settings,
    profiles.profiles,
    profiles.activeProfile?.id ?? null,
    ssh.settings,
    theme,
  ]);
  const [snapshot, setSnapshot] = useState<{ json: string; cache: unknown[]; theme: typeof theme } | null>(null);
  if (loaded && !snapshot) {
    setSnapshot({
      json: current,
      cache: SNAPSHOT_KEYS.map(([k]) => queryClient.getQueryData([k])),
      theme,
    });
  }
  const dirty = !!snapshot && snapshot.json !== current;

  const cancel = async () => {
    if (!snapshot) return onClose();
    if (
      dirty &&
      !(await confirm("You changed some settings. If you close now they will NOT be saved. Continue?", {
        title: "Discard changes",
        kind: "warning",
      }))
    )
      return;
    if (dirty) {
      SNAPSHOT_KEYS.forEach(([q, c], i) => {
        if (snapshot.cache[i] === undefined) return;
        queryClient.setQueryData([q], snapshot.cache[i]);
        setConfig(c, snapshot.cache[i]);
      });
      setTheme(snapshot.theme);
    }
    onClose();
  };

  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]["id"]>("ui");
  const tab = TABS.find((t) => t.id === activeTab) ?? TABS[0];

  return (
    <Modal onClose={cancel} dismissible={false} width="w-[760px]">
      <div className="flex flex-col text-sm">
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-800 px-3 py-2">
          <span className="font-semibold text-neutral-200">Settings</span>
          <button
            onClick={cancel}
            title="Close"
            className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          >
            <X size={15} />
          </button>
        </div>
        <div className="flex h-[420px]">
          <div className="w-40 shrink-0 space-y-1 border-r border-neutral-800 bg-neutral-950 p-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${
                  t.id === activeTab
                    ? "bg-neutral-800 text-neutral-100"
                    : "text-neutral-400 hover:bg-neutral-900"
                }`}
              >
                <t.icon size={14} /> {t.label}
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1 overflow-auto p-4">
            <tab.Content />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-800 px-3 py-2">
          <button onClick={cancel} className="rounded bg-neutral-800 px-3 py-1.5 text-neutral-200 hover:bg-neutral-700">
            Cancel
          </button>
          <button onClick={onClose} className="rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-500">
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
