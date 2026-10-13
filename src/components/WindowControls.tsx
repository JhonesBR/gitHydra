import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";

/** Minimize / maximize-restore / close for the undecorated window (the
 * native GNOME title bar is turned off in tauri.conf.json). */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    const sync = () => win.isMaximized().then(setMaximized).catch(() => {});
    sync();
    // Maximizing via double-click on the drag region or a WM shortcut resizes too.
    const unlisten = win.onResized(sync);
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  const button = "flex h-9 w-11 items-center justify-center text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100";

  return (
    <div className="-mr-2 flex shrink-0 items-center">
      <button title="Minimize" onClick={() => getCurrentWindow().minimize()} className={button}>
        <Minus size={15} />
      </button>
      <button
        title={maximized ? "Restore" : "Maximize"}
        onClick={() => getCurrentWindow().toggleMaximize()}
        className={button}
      >
        {maximized ? <Copy size={13} className="-scale-x-100" /> : <Square size={13} />}
      </button>
      <button
        title="Close"
        onClick={() => getCurrentWindow().close()}
        className={`${button} hover:!bg-red-600 hover:!text-white`}
      >
        <X size={16} />
      </button>
    </div>
  );
}
