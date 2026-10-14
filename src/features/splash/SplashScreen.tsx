import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getSavedTabPaths } from "@/features/repository/store";
import { fetchRepoAtPath } from "@/features/workspaces/api";
import { basename } from "@/lib/path";
import type { GitCommandError } from "@/lib/tauri-client";

// Long enough for the logo's intro (branches growing, heads popping) to play.
const MIN_VISIBLE_MS = 1600;
// Never hold the app hostage: past this, the splash closes and any fetches
// still running just finish in the background.
const MAX_VISIBLE_MS = 25_000;
const FETCH_CONCURRENCY = 4;
const FADE_MS = 350;
// An unreachable update server must not delay startup.
const UPDATE_CHECK_MS = 5000;

type Progress =
  | { phase: "loading" }
  | { phase: "updating"; version: string; pct: number | null }
  | { phase: "fetching"; done: number; total: number; failed: number; current: string | null }
  | { phase: "finished"; total: number; failed: number; locked: number };

/** Runs `worker` over `items` with at most `limit` in flight at once. */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await worker(items[next++]);
  });
  await Promise.all(lanes);
}

/** Installs a pending update and restarts into it; resolves quietly if there's none or anything fails. */
async function applyUpdate(onProgress: (version: string, pct: number | null) => void) {
  try {
    const update = await Promise.race([check(), new Promise<null>((r) => setTimeout(() => r(null), UPDATE_CHECK_MS))]);
    if (!update) return;
    let total = 0;
    let got = 0;
    onProgress(update.version, null);
    await update.downloadAndInstall((e) => {
      if (e.event === "Started") total = e.data.contentLength ?? 0;
      else if (e.event === "Progress") {
        got += e.data.chunkLength;
        onProgress(update.version, total ? got / total : null);
      }
    });
    await relaunch();
  } catch {
    // offline, unsigned, dev build…: carry on with the current version
  }
}

/**
 * Launch screen: the animated logo and name, while the repos open in tabs
 * (as saved last session) get fetched, FETCH_CONCURRENCY at a time, with live
 * progress. Skip / Esc closes it at any time; failures are counted, never fatal.
 */
export function SplashScreen({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<Progress>({ phase: "loading" });
  const [leaving, setLeaving] = useState(false);
  const started = useRef(false);
  const shownAt = useRef(performance.now());
  const updating = useRef(false);

  const leave = useRef(() => {});
  leave.current = () => {
    if (leaving || updating.current) return;
    setLeaving(true);
    setTimeout(onDone, FADE_MS);
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      if (!import.meta.env.DEV) {
        updating.current = true;
        await applyUpdate((version, pct) => setProgress({ phase: "updating", version, pct }));
        updating.current = false;
      }
      setProgress({ phase: "loading" });
      const paths = await getSavedTabPaths().catch(() => []);
      const repos = paths.map((path) => ({ path, name: basename(path) }));

      let done = 0;
      let failed = 0;
      // Skipped: their SSH key needs a passphrase, which only a fetch/push the user starts asks for.
      let locked = 0;
      // Several fetches run at once; show the one that started last.
      let current: string | null = null;
      const report = () => setProgress({ phase: "fetching", done, total: repos.length, failed, current });
      report();
      await runPool(repos, FETCH_CONCURRENCY, async (repo) => {
        current = repo.name;
        report();
        try {
          await fetchRepoAtPath(repo.path, { background: true });
        } catch (e) {
          if ((e as GitCommandError)?.kind === "SshPassphraseRequired") locked++;
          else failed++;
        }
        done++;
        report();
      });
      setProgress({ phase: "finished", total: repos.length, failed, locked });
      // Anything already loaded (restored tabs, branch lists) picks up the new remote state.
      queryClient.invalidateQueries();

      const remaining = MIN_VISIBLE_MS - (performance.now() - shownAt.current);
      setTimeout(() => leave.current(), Math.max(remaining, 500));
    })();
  }, [queryClient]);

  useEffect(() => {
    const cap = setTimeout(() => leave.current(), MAX_VISIBLE_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") leave.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(cap);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const ratio =
    progress.phase === "updating"
      ? (progress.pct ?? 0)
      : progress.phase === "fetching" ? (progress.total ? progress.done / progress.total : 1) : progress.phase === "finished" ? 1 : 0;

  const status =
    progress.phase === "updating"
      ? `Updating to v${progress.version}…${progress.pct != null ? ` ${Math.round(progress.pct * 100)}%` : ""}`
      : progress.phase === "loading"
      ? "Loading open tabs…"
      : progress.phase === "fetching"
        ? progress.total === 0
          ? "No open tabs to fetch"
          : `Fetching open tabs ${progress.done}/${progress.total}`
        : progress.total === 0
          ? "Ready"
          : progress.failed + progress.locked > 0
            ? [
                `Fetched ${progress.total - progress.failed - progress.locked}/${progress.total}`,
                progress.failed > 0 && `${progress.failed} failed`,
                progress.locked > 0 && `${progress.locked} need SSH passphrase`,
              ]
                .filter(Boolean)
                .join(" · ")
            : `Up to date · ${progress.total} ${progress.total === 1 ? "tab" : "tabs"}`;

  return (
    <div
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-neutral-950 transition-opacity"
      style={{ opacity: leaving ? 0 : 1, transitionDuration: `${FADE_MS}ms` }}
    >
      <img src="/logo.svg" alt="" className="h-44 w-44 drop-shadow-2xl" />
      <h1 className="mt-6 text-4xl font-bold tracking-tight text-neutral-100">gitHydra</h1>

      <div className="mt-10 flex w-72 flex-col items-center gap-2">
        <div className="h-1 w-full overflow-hidden rounded-full bg-neutral-800">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${progress.phase === "loading" ? "w-1/4 animate-pulse" : ""}`}
            style={{
              backgroundColor: "var(--head-color)",
              ...(progress.phase !== "loading" && { width: `${ratio * 100}%` }),
            }}
          />
        </div>
        <p className="text-xs text-neutral-400">{status}</p>
        <p className="h-4 truncate text-[11px] text-neutral-600">
          {progress.phase === "fetching" && progress.current}
        </p>
      </div>

      <button
        onClick={() => leave.current()}
        className="absolute bottom-6 right-6 rounded px-3 py-1.5 text-xs text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300"
      >
        Skip (Esc)
      </button>
    </div>
  );
}
