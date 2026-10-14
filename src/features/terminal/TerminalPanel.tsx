import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Settings, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ResizeHandle } from "@/components/ResizeHandle";
import { Select } from "@/components/Select";
import { usePersistedValue, usePersistedNumber } from "@/lib/use-persisted-config";
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
const FALLBACK_FONTS = [
  "gitHydra Symbols",
  "Symbols Nerd Font Mono",
  "Symbols Nerd Font",
  "MesloLGS NF",
  "MesloLGS Nerd Font",
  "FiraCode Nerd Font",
  "JetBrainsMono Nerd Font",
  "Hack Nerd Font",
  "CaskaydiaCove Nerd Font",
  "Cascadia Code",
  "Consolas",
  "Liberation Mono",
  "Menlo",
  "monospace",
];

const DEFAULT_FONT_SIZE = 13;

// Candidates offered in the settings list; only the installed ones show up
// (a webview can't enumerate system fonts, so each is probed by measuring).
const FONT_CHOICES = [
  "MesloLGS NF",
  "MesloLGS Nerd Font",
  "FiraCode Nerd Font",
  "FiraCode Nerd Font Mono",
  "JetBrainsMono Nerd Font",
  "JetBrainsMono Nerd Font Mono",
  "Hack Nerd Font",
  "CaskaydiaCove Nerd Font",
  "CaskaydiaMono Nerd Font",
  "UbuntuMono Nerd Font",
  "DejaVuSansM Nerd Font",
  "Cascadia Code",
  "Cascadia Mono",
  "Fira Code",
  "JetBrains Mono",
  "Source Code Pro",
  "Ubuntu Mono",
  "DejaVu Sans Mono",
  "Liberation Mono",
  "Consolas",
  "Menlo",
];

function installedFonts(): string[] {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return [];
  const width = (font: string, text: string) => {
    ctx.font = `72px ${font}`;
    return ctx.measureText(text).width;
  };
  // A font is installed if swapping it in changes the width vs. both generic
  // fallbacks (it can't equal both by accident).
  const probe = "mmmmmmmmmmlliWWW@#";
  const base = ["monospace", "serif"].map((g) => width(g, probe));
  return FONT_CHOICES.filter((name) =>
    ["monospace", "serif"].some((g, i) => width(`"${name}", ${g}`, probe) !== base[i]),
  );
}

/** User font first (chosen in the terminal settings), then the fallbacks. */
const fontStack = (custom: string) =>
  [custom.trim(), ...FALLBACK_FONTS]
    .filter(Boolean)
    .map((name) => (name.includes(" ") && !name.includes('"') ? `"${name}"` : name))
    .join(", ");

export function TerminalPanel({
  repoId,
  cwd,
  onClose,
  onKill,
}: {
  repoId: string;
  cwd: string;
  onClose: () => void;
  /** Shift+click on close: hide and kill the shell (panel unmounts, which kills it). */
  onKill: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [userFont, setUserFont, fontLoaded] = usePersistedValue("terminal.fontFamily", "");
  const [fontSize, setFontSize] = usePersistedNumber("terminal.fontSize", DEFAULT_FONT_SIZE);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fonts] = useState(installedFonts);
  const fitRef = useRef<FitAddon | null>(null);
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
      fontSize,
      fontFamily: fontStack(userFont),
      theme: xtermTheme(),
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();
    termRef.current = term;
    fitRef.current = fitAddon;

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

  useEffect(() => {
    const term = termRef.current;
    if (!term || !fontLoaded) return;
    term.options.fontFamily = fontStack(userFont);
    term.options.fontSize = fontSize;
    // Glyph metrics changed: refit and tell the pty the new size.
    fitRef.current?.fit();
    terminalResize(repoId, term.cols, term.rows);
  }, [userFont, fontSize, fontLoaded, repoId]);

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
          <div className="relative ml-auto mr-1 flex">
            <button
              onClick={() => setSettingsOpen((o) => !o)}
              title="Terminal settings"
              className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            >
              <Settings size={13} />
            </button>
            {settingsOpen && (
              <>
                <div className="fixed inset-0 z-10" onMouseDown={() => setSettingsOpen(false)} />
                <div className="absolute right-0 top-full z-20 mt-1 w-64 space-y-2 rounded border border-neutral-700 bg-neutral-900 p-2 text-xs text-neutral-300 shadow-xl">
                  <div className="text-neutral-500">
                    Font
                    <div className="mt-0.5">
                      <Select
                        value={userFont}
                        onChange={setUserFont}
                        options={[
                          { value: "", label: "Default" },
                          ...(userFont && !fonts.includes(userFont) ? [userFont, ...fonts] : fonts).map((f) => ({
                            value: f,
                            label: f,
                          })),
                        ]}
                      />
                    </div>
                  </div>
                  <label className="block text-neutral-500">
                    Size
                    <div className="mt-0.5 flex items-center gap-2">
                      <input
                        type="range"
                        min={8}
                        max={24}
                        value={fontSize}
                        onChange={(e) => setFontSize(Number(e.currentTarget.value))}
                        className="min-w-0 flex-1 accent-emerald-600"
                      />
                      <span className="w-8 text-right text-neutral-300">{fontSize}px</span>
                    </div>
                  </label>
                </div>
              </>
            )}
          </div>
          <button
            onClick={(e) => (e.shiftKey ? onKill() : onClose())}
            title="Close terminal (Ctrl+'). Shift+click kills the shell"
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
