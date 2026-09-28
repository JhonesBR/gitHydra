import { useEffect, useRef, useState, type ReactNode } from "react";

export function Popover({
  trigger,
  children,
}: {
  trigger: (props: { onClick: () => void }) => ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      {trigger({ onClick: () => setOpen((o) => !o) })}
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded border border-neutral-700 bg-neutral-900 p-2 shadow-xl">
          {children}
        </div>
      )}
    </div>
  );
}
