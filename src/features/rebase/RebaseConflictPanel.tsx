import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { queryKeys } from "@/lib/query-keys";
import { errorMessage } from "@/lib/tauri-client";
import { abortRebase, continueRebase, resolveRebaseConflict } from "./api";
import { useRebaseStore } from "./store";
import type { ConflictResolution } from "./types";

export function RebaseConflictPanel({ repoId }: { repoId: string }) {
  const status = useRebaseStore((s) => s.status);
  const setStatus = useRebaseStore((s) => s.setStatus);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  if (!status) return null;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.commitLog(repoId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.branches(repoId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.repoStatus(repoId) });
  };

  const resolve = async (path: string, resolution: ConflictResolution) => {
    try {
      const next = await resolveRebaseConflict(repoId, path, resolution);
      if (next.conflicts.length === 0) {
        // Last conflict of this step just got resolved — auto-advance instead
        // of waiting for a manual click; the rebase only pauses for conflicts.
        await doContinue();
      } else {
        setStatus(next);
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const doContinue = async () => {
    try {
      const next = await continueRebase(repoId);
      if (next.state === "Complete") {
        setStatus(null);
        invalidateAll();
      } else {
        setStatus(next);
      }
    } catch (e) {
      const message = errorMessage(e);
      // Backend has no session to continue (e.g. lost after a crash/race) — nothing to
      // show a stuck panel for, dismiss instead of leaving the user with no way out.
      if (message.includes("no rebase in progress")) {
        setStatus(null);
        invalidateAll();
      } else {
        setError(message);
      }
    }
  };

  const doAbort = async () => {
    try {
      await abortRebase(repoId);
    } catch (e) {
      setError(errorMessage(e));
    }
    setStatus(null);
    invalidateAll();
  };

  const allResolved = status.conflicts.length === 0;

  return (
    <div className="rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-100">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span>
          Rebase in progress — step {status.currentStep}/{status.totalSteps}
          {!allResolved && ` — ${status.conflicts.length} conflict(s)`}
        </span>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={doContinue}
            disabled={!allResolved}
            className="rounded bg-amber-800 px-2 py-1 hover:bg-amber-700 disabled:opacity-40"
          >
            Continue
          </button>
          <button
            onClick={doAbort}
            className="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700"
          >
            Abort
          </button>
        </div>
      </div>
      {error && <p className="mb-2 text-red-400">{error}</p>}
      <ul className="space-y-1">
        {status.conflicts.map((c) => (
          <li
            key={c.path}
            className="flex items-center justify-between gap-2 rounded bg-black/20 px-2 py-1"
          >
            <span className="truncate font-mono text-xs">{c.path}</span>
            <div className="flex shrink-0 gap-1">
              <button
                onClick={() => resolve(c.path, { kind: "UseOurs" })}
                className="rounded bg-neutral-800 px-2 py-0.5 text-xs hover:bg-neutral-700"
              >
                use ours
              </button>
              <button
                onClick={() => resolve(c.path, { kind: "UseTheirs" })}
                className="rounded bg-neutral-800 px-2 py-0.5 text-xs hover:bg-neutral-700"
              >
                use theirs
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
