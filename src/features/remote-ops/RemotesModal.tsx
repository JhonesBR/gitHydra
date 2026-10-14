import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cloud, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { confirm } from "@/lib/confirm-store";
import { queryKeys } from "@/lib/query-keys";
import { errorMessage } from "@/lib/tauri-client";
import { addRemote, removeRemote, renameRemote, setRemoteUrl } from "./api";
import { remoteNameProblem } from "./remotes";
import type { RemoteInfo } from "./types";
import { useRemotes } from "./useRemotes";

const inputClass =
  "min-w-0 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-neutral-500";

/** Add / rename / re-point / remove the repo's remotes (`git remote ...`). */
export function RemotesModal({ repoId, onClose }: { repoId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: remotes } = useRemotes(repoId);
  const names = (remotes ?? []).map((r) => r.name);
  const [editing, setEditing] = useState<{ from: string; name: string; url: string } | null>(null);
  const [draft, setDraft] = useState({ name: "", url: "" });

  const mutation = useMutation({
    mutationFn: (run: () => Promise<RemoteInfo[]>) => run(),
    onSuccess: (list) => {
      queryClient.setQueryData(queryKeys.remotes(repoId), list);
      // Renames/removals move or drop remote-tracking branches (and their pills).
      queryClient.invalidateQueries({ queryKey: queryKeys.branches(repoId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.commitLog(repoId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.repoStatus(repoId) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const addProblem = remoteNameProblem(draft.name, names) ?? (draft.url.trim() ? null : "URL is required");
  const editProblem = editing
    ? (remoteNameProblem(editing.name, names, editing.from) ?? (editing.url.trim() ? null : "URL is required"))
    : null;

  const saveEdit = async () => {
    if (!editing || editProblem) return;
    const before = remotes?.find((r) => r.name === editing.from);
    const name = editing.name.trim();
    const url = editing.url.trim();
    try {
      if (name !== editing.from) await mutation.mutateAsync(() => renameRemote(repoId, editing.from, name));
      if (url !== (before?.fetchUrl ?? "")) await mutation.mutateAsync(() => setRemoteUrl(repoId, name, url));
      setEditing(null);
    } catch {
      // toasted by the mutation
    }
  };

  const remove = async (name: string) => {
    const ok = await confirm(
      `Remove remote "${name}"? Its remote-tracking branches go away too; nothing on the server changes.`,
      { title: "Remove remote", kind: "warning" },
    );
    if (ok) mutation.mutate(() => removeRemote(repoId, name));
  };

  return (
    <Modal onClose={onClose} width="w-[600px]">
      <div className="flex flex-col text-sm">
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
          <h2 className="font-semibold text-neutral-100">Remotes</h2>
          <button onClick={onClose} title="Close" className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100">
            <X size={15} />
          </button>
        </div>

        <ul className="max-h-[50vh] divide-y divide-neutral-800 overflow-auto">
          {remotes?.length === 0 && <li className="px-4 py-3 text-neutral-500">No remotes yet.</li>}
          {remotes?.map((r) =>
            editing?.from === r.name ? (
              <li key={r.name} className="px-4 py-2">
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveEdit();
                  }}
                >
                  <input
                    autoFocus
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className={`w-28 ${inputClass}`}
                  />
                  <input
                    value={editing.url}
                    onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                    className={`flex-1 ${inputClass}`}
                  />
                  <button
                    type="submit"
                    disabled={!!editProblem || mutation.isPending}
                    title={editProblem ?? undefined}
                    className="rounded bg-neutral-700 px-2 py-1 text-neutral-100 hover:bg-neutral-600 disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="rounded bg-neutral-800 px-2 py-1 text-neutral-200 hover:bg-neutral-700"
                  >
                    Cancel
                  </button>
                </form>
                {editProblem && <p className="mt-1 text-xs text-amber-400">{editProblem}</p>}
              </li>
            ) : (
              <li key={r.name} className="flex items-center gap-2 px-4 py-2">
                <Cloud size={13} className="shrink-0 text-neutral-400" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-neutral-100">{r.name}</div>
                  <div className="truncate text-xs text-neutral-500" title={r.fetchUrl ?? ""}>
                    {r.fetchUrl ?? "(no URL)"}
                  </div>
                  {r.pushUrl && (
                    <div className="truncate text-xs text-neutral-500" title={r.pushUrl}>
                      push: {r.pushUrl}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setEditing({ from: r.name, name: r.name, url: r.fetchUrl ?? "" })}
                  disabled={mutation.isPending}
                  title="Rename or change URL"
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-50"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => remove(r.name)}
                  disabled={mutation.isPending}
                  title="Remove"
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-red-400 disabled:opacity-50"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ),
          )}
        </ul>

        <form
          className="flex items-center gap-2 border-t border-neutral-800 px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (addProblem) return;
            mutation.mutate(() => addRemote(repoId, draft.name.trim(), draft.url.trim()), {
              onSuccess: () => setDraft({ name: "", url: "" }),
            });
          }}
        >
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={names.length ? "name" : "origin"}
            className={`w-28 ${inputClass}`}
          />
          <input
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            placeholder="https://host/owner/repo.git or git@host:owner/repo.git"
            className={`flex-1 ${inputClass}`}
          />
          <button
            type="submit"
            disabled={!!addProblem || mutation.isPending}
            title={addProblem ?? undefined}
            className="flex shrink-0 items-center gap-1 rounded bg-neutral-700 px-2 py-1 text-neutral-100 hover:bg-neutral-600 disabled:opacity-50"
          >
            {mutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add
          </button>
        </form>
      </div>
    </Modal>
  );
}
