import { Modal } from "@/components/Modal";
import { SshKeySelect } from "./SshKeySelect";

export function RepoSshKeyModal({ repoPath, onClose }: { repoPath: string; onClose: () => void }) {
  return (
    <Modal onClose={onClose} width="w-[420px]">
      <div className="p-4">
        <h2 className="mb-1 text-sm font-semibold text-neutral-100">SSH key for this repository</h2>
        <p className="mb-3 break-all text-xs text-neutral-500">{repoPath}</p>
        <SshKeySelect dir={repoPath} />
        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 hover:bg-neutral-600"
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
