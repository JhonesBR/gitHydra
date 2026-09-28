import { useEffect } from "react";
import { createPortal } from "react-dom";

export function Modal({
  onClose,
  children,
  align = "center",
}: {
  onClose: () => void;
  children: React.ReactNode;
  align?: "center" | "top";
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className={`fixed inset-0 z-[200] flex justify-center bg-black/60 ${
        align === "top" ? "items-start pt-[15vh]" : "items-center"
      }`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[560px] max-w-[90vw] overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 shadow-2xl">
        {children}
      </div>
    </div>,
    document.body,
  );
}
