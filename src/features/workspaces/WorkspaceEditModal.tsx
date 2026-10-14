import { Check } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { SshKeySelect } from "@/features/ssh-keys/SshKeySelect";
import type { WorkspaceEntry, WorkspaceRepoEntry } from "./types";

export function WorkspaceEditModal({
  workspace,
  repos,
  onClose,
  onRename,
  onSetIgnoredPaths,
}: {
  workspace: WorkspaceEntry;
  repos: WorkspaceRepoEntry[];
  onClose: () => void;
  onRename: (name: string) => void;
  onSetIgnoredPaths: (paths: string[]) => void;
}) {
  const [name, setName] = useState(workspace.name);

  const commitRename = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== workspace.name) onRename(trimmed);
  };

  const toggleIgnored = (path: string) => {
    const ignored = new Set(workspace.ignoredPaths);
    if (ignored.has(path)) ignored.delete(path);
    else ignored.add(path);
    onSetIgnoredPaths([...ignored]);
  };

  return (
    <Modal onClose={onClose}>
      <div className="p-4">
        <label className="mb-1 block text-xs uppercase text-neutral-500">Workspace name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onBlur={commitRename}
          onKeyDown={(e) => e.key === "Enter" && commitRename()}
          className="mb-4 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100"
        />

        <p className="mb-1 text-xs uppercase text-neutral-500">SSH key</p>
        <div className="mb-4">
          <SshKeySelect dir={workspace.path} />
        </div>

        <p className="mb-1 text-xs uppercase text-neutral-500">
          Repositories ({repos.length - workspace.ignoredPaths.length}/{repos.length} included)
        </p>
        <ul className="max-h-72 overflow-auto rounded border border-neutral-800">
          {repos.map((r) => {
            const included = !workspace.ignoredPaths.includes(r.path);
            return (
              <li
                key={r.path}
                onClick={() => toggleIgnored(r.path)}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-neutral-900"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    included ? "border-emerald-500 bg-emerald-900/60" : "border-neutral-600"
                  }`}
                >
                  {included && <Check size={11} className="text-emerald-300" />}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate ${
                    included ? "text-neutral-200" : "text-neutral-500 line-through"
                  }`}
                >
                  {r.name}
                </span>
              </li>
            );
          })}
          {repos.length === 0 && (
            <li className="px-3 py-2 text-xs text-neutral-500">No repositories found</li>
          )}
        </ul>

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-600"
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
