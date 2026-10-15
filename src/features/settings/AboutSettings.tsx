import { useState } from "react";
import { toast } from "sonner";
import type { Update } from "@tauri-apps/plugin-updater";
import { installCliLauncher } from "@/features/cli/api";
import { errorMessage } from "@/lib/tauri-client";
import { checkForUpdate, installAndRestart } from "@/lib/updater";
import { useAutoUpdate } from "./useAutoUpdate";

export function AboutSettings() {
  const { autoUpdate, setAutoUpdate } = useAutoUpdate();
  const [busy, setBusy] = useState(false);
  const [update, setUpdate] = useState<Update | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [installing, setInstalling] = useState(false);

  const checkNow = async () => {
    setBusy(true);
    try {
      const found = await checkForUpdate(15_000);
      setUpdate(found);
      if (!found) toast.success("gitHydra is up to date");
    } catch (e) {
      toast.error(`Could not check for updates: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    if (!update) return;
    setInstalling(true);
    try {
      await installAndRestart(update, setPct);
    } catch (e) {
      setInstalling(false);
      toast.error(`Update failed: ${errorMessage(e)}`);
    }
  };

  const installCli = async () => {
    try {
      toast.success(`Installed ${await installCliLauncher()} — run "githydra -p ." in a repository`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="mb-1 text-sm font-semibold text-neutral-200">gitHydra</h2>
        <p className="text-xs text-neutral-500">Version {__APP_VERSION__}</p>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-200">Updates</h2>
        <label className="flex items-start gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={autoUpdate}
            onChange={(e) => setAutoUpdate(e.currentTarget.checked)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 appearance-none rounded-sm border border-neutral-600 bg-neutral-900 checked:border-emerald-600 checked:bg-emerald-600"
          />
          <span>
            Install updates automatically at launch
            <span className="block text-xs text-neutral-500">
              When off, use "Check for updates" below to update yourself.
            </span>
          </span>
        </label>
        <div className="flex items-center gap-3">
          <button
            onClick={checkNow}
            disabled={busy || installing}
            className="rounded bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
          >
            {busy ? "Checking…" : "Check for updates"}
          </button>
          {update && (
            <button
              onClick={install}
              disabled={installing}
              className="rounded bg-emerald-700 px-3 py-1.5 text-xs text-emerald-50 hover:bg-emerald-600 disabled:opacity-50"
            >
              {installing
                ? `Installing${pct !== null ? ` ${Math.round(pct * 100)}%` : "…"}`
                : `Install ${update.version} and restart`}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-200">Command line</h2>
        <p className="text-xs text-neutral-500">
          Adds a <code className="text-neutral-400">githydra</code> command: <code className="text-neutral-400">githydra</code>{" "}
          opens the app, <code className="text-neutral-400">githydra -p .</code> opens the current folder as a tab.
        </p>
        <button
          onClick={installCli}
          className="rounded bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700"
        >
          Install the githydra command
        </button>
      </div>
    </div>
  );
}
