import { Bot, Download, FileCode, Info, Keyboard, KeyRound, Paintbrush, PenLine, Plug, RefreshCw, ScrollText, UserCircle, X } from "lucide-react";
import { useActivityStore } from "@/features/activity/store";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { confirm } from "@/lib/confirm-store";
import { setConfig } from "@/lib/config-store";
import { useFontStore } from "@/lib/fonts";
import { useAppliedTheme, useTheme } from "@/lib/use-theme";
import { useAiSettings } from "@/features/ai/useAiSettings";
import { useIntegrationsSettings } from "@/features/integrations/useIntegrationsSettings";
import { useProfiles } from "@/features/profiles/useProfiles";
import { Modal } from "@/components/Modal";
import { AiSettings } from "@/features/ai/AiSettings";
import { IntegrationsSettings } from "@/features/integrations/IntegrationsSettings";
import { ProfilesSettings } from "@/features/profiles/ProfilesSettings";
import { FetchSettings } from "@/features/remote-ops/FetchSettings";
import { useAutoFetchSettings } from "@/features/remote-ops/useAutoFetch";
import { SshKeysSettings } from "@/features/ssh-keys/SshKeysSettings";
import { useSshKeySettings } from "@/features/ssh-keys/useSshKeys";
import { EditorSettings } from "@/features/editor/EditorSettings";
import { useDefaultEditor } from "@/features/editor/useEditorSettings";
import { ShortcutsSettings } from "@/features/shortcuts/ShortcutsSettings";
import { useShortcutOverrides } from "@/features/shortcuts/useShortcuts";
import { SigningSettings } from "@/features/signing/SigningSettings";
import { useSignCommits } from "@/features/signing/useSignCommits";
import { BackupSettings } from "./BackupSettings";
import { SNAPSHOT_KEYS } from "./keys";
import { AboutSettings } from "./AboutSettings";
import { ThemeSettings } from "./ThemeSettings";
import { useAutoUpdate } from "./useAutoUpdate";

const TABS = [
  { id: "ui" as const, label: "UI", icon: Paintbrush, Content: ThemeSettings },
  { id: "profiles" as const, label: "Profiles", icon: UserCircle, Content: ProfilesSettings },
  { id: "ssh" as const, label: "SSH Keys", icon: KeyRound, Content: SshKeysSettings },
  { id: "fetch" as const, label: "Fetch", icon: RefreshCw, Content: FetchSettings },
  { id: "editor" as const, label: "Editor", icon: FileCode, Content: EditorSettings },
  { id: "shortcuts" as const, label: "Shortcuts", icon: Keyboard, Content: ShortcutsSettings },
  { id: "signing" as const, label: "Signing", icon: PenLine, Content: SigningSettings },
  { id: "ai" as const, label: "AI Integration", icon: Bot, Content: AiSettings },
  { id: "integrations" as const, label: "Integrations", icon: Plug, Content: IntegrationsSettings },
  { id: "backup" as const, label: "Backup", icon: Download, Content: BackupSettings },
  { id: "about" as const, label: "About", icon: Info, Content: AboutSettings },
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  // Mounted here so every tab's data is in the cache (and loaded) from the start.
  const ai = useAiSettings();
  const integrations = useIntegrationsSettings();
  const profiles = useProfiles();
  const ssh = useSshKeySettings();
  const autoFetch = useAutoFetchSettings();
  const signing = useSignCommits();
  const editor = useDefaultEditor();
  const shortcuts = useShortcutOverrides();
  const autoUpdate = useAutoUpdate();
  const theme = useAppliedTheme();
  const [, setTheme] = useTheme();
  const fonts = useFontStore((s) => s.fonts);
  const loaded =
    ai.settingsLoaded &&
    integrations.settingsLoaded &&
    profiles.profilesLoaded &&
    ssh.settingsLoaded &&
    autoFetch.settingsLoaded &&
    signing.loaded &&
    editor.loaded &&
    shortcuts.loaded &&
    autoUpdate.loaded;
  const current = JSON.stringify([
    ai.settings,
    integrations.settings,
    profiles.profiles,
    profiles.activeProfile?.id ?? null,
    ssh.settings,
    autoFetch.minutes,
    signing.signCommits,
    editor.editorId,
    shortcuts.overrides,
    autoUpdate.autoUpdate,
    theme,
    fonts,
  ]);
  const [snapshot, setSnapshot] = useState<{ json: string; cache: unknown[]; theme: typeof theme; fonts: typeof fonts } | null>(null);
  if (loaded && !snapshot) {
    setSnapshot({
      json: current,
      cache: SNAPSHOT_KEYS.map(([k]) => queryClient.getQueryData([k])),
      theme,
      fonts,
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
      useFontStore.getState().set(snapshot.fonts);
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
          <button
            onClick={() => useActivityStore.getState().setOpen(true)}
            title="Activity Logs (Ctrl+L)"
            className="mr-auto flex items-center gap-1.5 rounded px-3 py-1.5 text-neutral-300 hover:bg-neutral-800"
          >
            <ScrollText size={14} /> Activity Logs
            <span className="text-xs text-neutral-500">Ctrl+L</span>
          </button>
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
