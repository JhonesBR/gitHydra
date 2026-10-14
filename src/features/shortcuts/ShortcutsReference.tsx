import { Modal } from "@/components/Modal";
import { ShortcutsList } from "./ShortcutsSettings";

export function ShortcutsReference({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} align="top" width="w-[480px]">
      <div className="max-h-[70vh] overflow-auto p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-200">Keyboard shortcuts</h2>
        <ShortcutsList editable={false} />
        <p className="mt-3 text-xs text-neutral-500">Change them in Settings → Shortcuts.</p>
      </div>
    </Modal>
  );
}
