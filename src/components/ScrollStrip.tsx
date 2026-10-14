import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/** Browser-tab-style horizontal strip: no scrollbar, arrow buttons with an
 * opacity fade appear on whichever side has hidden content, the wheel scrolls
 * it sideways, and the element marked `data-active` is kept in view.
 * `edgeClass` is the background color the fade blends into. */
export function ScrollStrip({
  children,
  activeKey,
  edgeClass = "from-neutral-900",
  className = "",
}: {
  children: ReactNode;
  /** Changes when the active item changes, to scroll it into view. */
  activeKey?: string | null;
  edgeClass?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 1);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    // Native non-passive listener so vertical wheel can be turned sideways.
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, [update]);

  useEffect(() => {
    ref.current?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeKey]);

  const scrollBy = (dir: -1 | 1) =>
    ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.6, behavior: "smooth" });

  const arrow = (side: "left" | "right", visible: boolean) => (
    <div
      className={`pointer-events-none absolute inset-y-0 z-10 flex items-center ${
        side === "left" ? "left-0 bg-gradient-to-r" : "right-0 bg-gradient-to-l"
      } ${edgeClass} via-transparent to-transparent transition-opacity duration-150 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <button
        tabIndex={visible ? 0 : -1}
        onClick={() => scrollBy(side === "left" ? -1 : 1)}
        className={`flex h-7 w-6 items-center justify-center rounded text-neutral-300 hover:text-neutral-100 ${
          visible ? "pointer-events-auto" : ""
        }`}
      >
        {side === "left" ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </button>
    </div>
  );

  return (
    <div className={`relative min-w-0 ${className}`}>
      <div
        ref={ref}
        onScroll={update}
        className="flex items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
      {arrow("left", canLeft)}
      {arrow("right", canRight)}
    </div>
  );
}
