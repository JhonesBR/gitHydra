import { Modal } from "@/components/Modal";
import { ResizableSidebar } from "@/components/ResizableSidebar";
import { useTauriEvent } from "@/lib/tauri-events";
import { ActivityLogView } from "./ActivityLogView";
import { type PinSide, useActivityStore } from "./store";

type BackendActivity = { repoPath: string | null; level: "info" | "error"; message: string };

/** Collects what the backend reports and shows the log as a popup when it isn't pinned. */
export function ActivityLogHost() {
  const add = useActivityStore((s) => s.add);
  const open = useActivityStore((s) => s.open);
  const pin = useActivityStore((s) => s.pin);
  const setOpen = useActivityStore((s) => s.setOpen);

  useTauriEvent<BackendActivity>("activity://log", (e) =>
    add({
      source: "backend",
      text: e.message,
      read: false,
      repoPath: e.repoPath,
      status: e.level === "error" ? "error" : "info",
    }),
  );

  if (!open || pin) return null;
  return (
    <Modal onClose={() => setOpen(false)} width="w-[900px]">
      <div className="h-[70vh]">
        <ActivityLogView onClose={() => setOpen(false)} />
      </div>
    </Modal>
  );
}

/** The log docked on one side, to keep an eye on it while using the app. */
export function ActivityLogDock({ side }: { side: PinSide }) {
  const open = useActivityStore((s) => s.open);
  const pin = useActivityStore((s) => s.pin);
  const setOpen = useActivityStore((s) => s.setOpen);
  if (!open || pin !== side) return null;
  return (
    <ResizableSidebar configKey="activityLogWidth" side={side} defaultWidth={420} minWidth={280} maxWidth={900}>
      <ActivityLogView onClose={() => setOpen(false)} />
    </ResizableSidebar>
  );
}
