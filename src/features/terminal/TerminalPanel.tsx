import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { ResizeHandle } from "@/components/ResizeHandle";
import { usePersistedNumber } from "@/lib/use-persisted-config";
import { useTauriEvent } from "@/lib/tauri-events";
import { useAppliedTheme } from "@/lib/use-theme";
import { terminalKill, terminalResize, terminalSpawn, terminalWrite } from "./api";
import type { TerminalOutputEvent } from "./api";

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 640;

/** Reads the active theme's text color, so the terminal stays legible in
 * light themes too (a fixed light gray vanished on light backgrounds). */
function xtermTheme() {
  const fg = getComputedStyle(document.documentElement).getPropertyValue("--color-neutral-300").trim();
  return { background: "#00000000", foreground: fg || "#d4d4d8", cursor: fg || "#d4d4d8" };
}

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
  const [height, setHeight] = usePersistedNumber("terminal.height", 256);

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
      theme: xtermTheme(),
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

  const appliedTheme = useAppliedTheme();
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme();
  }, [appliedTheme]);

  return (
    <div className="flex shrink-0 flex-col" style={{ height }}>
      <ResizeHandle
        axis="y"
        onDrag={(dy) => setHeight((h) => Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h - dy)))}
      />
      <div className="flex min-h-0 flex-1 flex-col bg-neutral-950">
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
    </div>
  );
}
