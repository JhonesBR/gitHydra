import type { ReactNode } from "react";
import { usePersistedNumber } from "@/lib/use-persisted-config";
import { ResizeHandle } from "./ResizeHandle";

/** A right-docked panel with a drag handle on its left edge — drag left to
 * expand, right to shrink. Width persists across app restarts. */
export function ResizableSidebar({
  children,
  configKey,
  defaultWidth = 360,
  minWidth = 260,
  maxWidth = 720,
}: {
  children: ReactNode;
  configKey: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
}) {
  const [width, setWidth] = usePersistedNumber(configKey, defaultWidth);

  return (
    <div className="flex h-full shrink-0" style={{ width }}>
      <ResizeHandle
        onDrag={(dx) => setWidth((w) => Math.min(maxWidth, Math.max(minWidth, w - dx)))}
        className="bg-neutral-800"
      />
      <div className="min-w-0 flex-1 overflow-hidden rounded border border-neutral-800">
        {children}
      </div>
    </div>
  );
}
