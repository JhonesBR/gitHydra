import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTauriEvent } from "@/lib/tauri-events";
import { terminalKill, terminalResize, terminalSpawn, terminalWrite } from "./api";
import type { TerminalOutputEvent } from "./api";

const XTERM_THEME = {
  background: "#00000000",
  foreground: "#d4d4d8",
  cursor: "#d4d4d8",
};

// Falls through to whichever of these is actually installed — Nerd Font
// variants first, since prompts like Powerlevel10k/oh-my-posh need one for
// their glyphs, then common system monospace fonts, then a generic fallback.
const TERMINAL_FONT_FAMILY = [
  "MesloLGS NF",
  "FiraCode Nerd Font",
  "JetBrainsMono Nerd Font",
  "Hack Nerd Font",
  "CaskaydiaCove Nerd Font",
  "Cascadia Code",
  "Consolas",
  "Liberation Mono",
  "Menlo",
  "monospace",
]
  .map((name) => (name.includes(" ") ? `"${name}"` : name))
  .join(", ");

export function TerminalPanel({
  repoId,
  cwd,
  onClose,
}: {
  repoId: string;
  cwd: string;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useTauriEvent<TerminalOutputEvent>("terminal://output", (p) => {
    if (p.repoId !== repoId) return;
    termRef.current?.write(p.data);
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      convertEol: true,
      fontSize: 13,
      fontFamily: TERMINAL_FONT_FAMILY,
      theme: XTERM_THEME,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();
    termRef.current = term;

    terminalSpawn(repoId, cwd).then(() => terminalResize(repoId, term.cols, term.rows));

    const dataDisposable = term.onData((data) => {
      terminalWrite(repoId, data);
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      terminalResize(repoId, term.cols, term.rows);
    });
    resizeObserver.observe(container);

    return () => {
      dataDisposable.dispose();
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      terminalKill(repoId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, cwd]);

  return (
    <div className="flex h-64 flex-col border-t border-neutral-800 bg-neutral-950">
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-800 px-2 py-1">
        <span className="text-xs uppercase text-neutral-500">Terminal</span>
        <button
          onClick={onClose}
          title="Close terminal (Ctrl+')"
          className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          <X size={13} />
        </button>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 px-1 py-1" />
    </div>
  );
}
