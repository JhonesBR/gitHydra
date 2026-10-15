import { useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { setConfig } from "@/lib/config-store";
import { confirm } from "@/lib/confirm-store";
import { useFontStore } from "@/lib/fonts";
import { useAppliedTheme, useTheme } from "@/lib/use-theme";
import { errorMessage } from "@/lib/tauri-client";
import { SNAPSHOT_KEYS } from "./keys";

const FORMAT = "githydra-settings";
const filters = [{ name: "gitHydra settings", extensions: ["json"] }];

export function BackupSettings() {
  const queryClient = useQueryClient();
  const theme = useAppliedTheme();
  const [, setTheme] = useTheme();

  const doExport = async () => {
    try {
      const path = await save({ defaultPath: "githydra-settings.json", filters });
      if (!path) return;
      const settings = Object.fromEntries(
        SNAPSHOT_KEYS.map(([q]) => [q, queryClient.getQueryData([q])]).filter(([, v]) => v !== undefined),
      );
      const data = { format: FORMAT, version: 1, settings, theme, fonts: useFontStore.getState().fonts };
      // invoke, not call(): `call` logs args to Activity Logs and this holds secrets.
      await invoke("write_text_file", { path, contents: JSON.stringify(data, null, 2) });
      toast.success(`Settings exported to ${path}`);
    } catch (e) {
      toast.error(`Export failed: ${errorMessage(e)}`);
    }
  };

  const doImport = async () => {
    try {
      const path = await open({ filters, multiple: false });
      if (typeof path !== "string") return;
      const data = JSON.parse(await invoke<string>("read_text_file", { path }));
      if (data?.format !== FORMAT || typeof data.settings !== "object") throw new Error("not a gitHydra settings file");
      if (
        !(await confirm("Importing replaces your current settings (including API keys and tokens). Continue?", {
          title: "Import settings",
          kind: "warning",
        }))
      )
        return;
      for (const [q, c] of SNAPSHOT_KEYS) {
        if (data.settings[q] === undefined) continue;
        queryClient.setQueryData([q], data.settings[q]);
        setConfig(c, data.settings[q]);
      }
      if (data.theme) setTheme(data.theme);
      if (data.fonts) useFontStore.getState().set(data.fonts);
      toast.success("Settings imported");
    } catch (e) {
      toast.error(`Import failed: ${errorMessage(e)}`);
    }
  };

  const btn = "flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-1.5 text-neutral-200 hover:bg-neutral-700";
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-neutral-200">Backup</h2>
      <div className="flex gap-2 rounded border border-amber-700/60 bg-amber-950/30 p-3 text-xs text-amber-300">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <span>
          The exported file may contain secrets (AI API keys, GitHub/GitLab tokens) in plain text. Anyone with the file
          can use them — store it somewhere safe and never commit or share it.
        </span>
      </div>
      <div className="flex gap-2">
        <button onClick={doExport} className={btn}>
          <Download size={14} /> Export settings
        </button>
        <button onClick={doImport} className={btn}>
          <Upload size={14} /> Import settings
        </button>
      </div>
    </div>
  );
}
