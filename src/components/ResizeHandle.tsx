import { useRef } from "react";

/** A draggable strip that reports horizontal drag deltas. Uses Pointer Events
 * with explicit capture on the handle itself — more robust than window-level
 * mouse listeners inside an embedded webview (keeps receiving move/up events
 * no matter how fast the cursor moves or briefly leaves the element). */
export function ResizeHandle({ onDrag, className = "" }: { onDrag: (deltaX: number) => void; className?: string }) {
  const lastX = useRef(0);

  return (
    <div
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        lastX.current = e.clientX;
      }}
      onPointerMove={(e) => {
        if (e.buttons !== 1) return;
        const dx = e.clientX - lastX.current;
        if (dx === 0) return;
        lastX.current = e.clientX;
        onDrag(dx);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      className={`w-2 shrink-0 cursor-col-resize touch-none bg-neutral-800 hover:bg-blue-500 active:bg-blue-500 ${className}`}
    />
  );
}
