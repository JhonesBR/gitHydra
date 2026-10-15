import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

/** `promise`, or `fallback` if it hasn't settled within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** A pending update, or null when up to date (or the server didn't answer within `timeoutMs`). Throws on a failed check. */
export const checkForUpdate = (timeoutMs = 5000): Promise<Update | null> => withTimeout(check(), timeoutMs, null);

/** Downloads and installs `update`, then restarts into it. `onProgress` gets 0..1, or null while the size is unknown. */
export async function installAndRestart(update: Update, onProgress: (fraction: number | null) => void) {
  let total = 0;
  let got = 0;
  onProgress(null);
  await update.downloadAndInstall((e) => {
    if (e.event === "Started") total = e.data.contentLength ?? 0;
    else if (e.event === "Progress") {
      got += e.data.chunkLength;
      onProgress(total ? got / total : null);
    }
  });
  await relaunch();
}
