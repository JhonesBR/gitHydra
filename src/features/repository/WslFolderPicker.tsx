import { ChevronUp, Folder, GitBranch } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { call, errorMessage } from "@/lib/tauri-client";

type DirEntry = { name: string; path: string; isRepo: boolean };

/** Browses a WSL distro through its agent (the native dialog crawls over 9P)
 * and hands back the chosen folder as a `\\wsl.localhost\...` path. */
export function WslFolderPicker({
  onPick,
  onClose,
}: {
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [distros, setDistros] = useState<string[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [dirs, setDirs] = useState<DirEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<string[]>("list_wsl_distros").then(setDistros, (e) => setError(errorMessage(e)));
  }, []);

  const go = async (path: string) => {
    setError(null);
    try {
      setDirs(await call<DirEntry[]>("list_wsl_dirs", { path }));
      setCurrent(path);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const openDistro = async (distro: string) => {
    setError(null);
    try {
      await go(await call<string>("wsl_home", { distro }));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const parent = current ? current.replace(/[\\/][^\\/]+[\\/]*$/, "") : null;
  const atDistroRoot = !!current && !/^[\\/]{2}wsl[^\\/]*[\\/]+[^\\/]+[\\/]+[^\\/]+/i.test(parent ?? "");

  return (
    <Modal onClose={onClose} width="w-[520px]">
      <div className="space-y-3 p-4">
        <h2 className="text-sm font-semibold text-neutral-100">Open from WSL</h2>
        {!current && (
          <div className="space-y-1">
            {distros?.length === 0 && <p className="text-sm text-neutral-500">No WSL distros found.</p>}
            {distros?.map((d) => (
              <button
                key={d}
                onClick={() => openDistro(d)}
                className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-800"
              >
                {d}
              </button>
            ))}
          </div>
        )}
        {current && (
          <>
            <p className="break-all text-xs text-neutral-500">{current}</p>
            <div className="max-h-72 space-y-0.5 overflow-auto">
              {!atDistroRoot && parent && (
                <button
                  onClick={() => go(parent)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-neutral-800"
                >
                  <ChevronUp size={14} /> ..
                </button>
              )}
              {dirs.map((d) => (
                <button
                  key={d.path}
                  onClick={() => go(d.path)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-neutral-800"
                >
                  {d.isRepo ? <GitBranch size={14} className="text-emerald-400" /> : <Folder size={14} />}
                  {d.name}
                </button>
              ))}
            </div>
          </>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700">
            Cancel
          </button>
          <button
            disabled={!current}
            onClick={() => current && onPick(current)}
            className="rounded bg-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-600 disabled:opacity-50"
          >
            Select this folder
          </button>
        </div>
      </div>
    </Modal>
  );
}
