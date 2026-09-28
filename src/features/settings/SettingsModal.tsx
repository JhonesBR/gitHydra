import { Paintbrush, UserCircle, X } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { ProfilesSettings } from "@/features/profiles/ProfilesSettings";
import { ThemeSettings } from "./ThemeSettings";

const TABS = [
  { id: "ui" as const, label: "UI", icon: Paintbrush, Content: ThemeSettings },
  { id: "profiles" as const, label: "Profiles", icon: UserCircle, Content: ProfilesSettings },
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]["id"]>("ui");
  const tab = TABS.find((t) => t.id === activeTab) ?? TABS[0];

  return (
    <Modal onClose={onClose}>
      <div className="flex flex-col text-sm">
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-800 px-3 py-2">
          <span className="font-semibold text-neutral-200">Settings</span>
          <button
            onClick={onClose}
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
      </div>
    </Modal>
  );
}
