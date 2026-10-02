import type { ReactNode } from "react";
import { refractor } from "refractor/all";

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "markup",
  htm: "markup",
  xml: "markup",
  vue: "markup",
  svelte: "markup",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  rb: "ruby",
  php: "php",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cc: "cpp",
  cs: "csharp",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
  toml: "ini",
  ini: "ini",
  lua: "lua",
  r: "r",
  pl: "perl",
};

/** Maps a file path to a refractor/Prism language name, or `null` when the
 * extension is unknown/unregistered — callers should fall back to plain text. */
export function guessLanguage(path: string): string | null {
  const name = path.split("/").pop() ?? path;
  if (/^makefile$/i.test(name)) return refractor.registered("makefile") ? "makefile" : null;
  const dot = name.lastIndexOf(".");
  if (dot === -1) return null;
  const lang = EXTENSION_TO_LANGUAGE[name.slice(dot + 1).toLowerCase()];
  return lang && refractor.registered(lang) ? lang : null;
}

type HastNode = {
  type: string;
  value?: string;
  properties?: { className?: string[] };
  children?: HastNode[];
};

function renderNodes(nodes: HastNode[] | undefined, keyPrefix: string): ReactNode {
  if (!nodes) return null;
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    if (node.type === "text") return node.value;
    return (
      <span key={key} className={node.properties?.className?.join(" ")}>
        {renderNodes(node.children, key)}
      </span>
    );
  });
}

/** Renders one line of code as syntax-highlighted spans (standard Prism
 * `.token.*` classes — colored per-theme in App.css), or plain text when the
 * language is unknown. */
export function highlightLine(content: string, language: string | null): ReactNode {
  if (!language) return content;
  try {
    const tree = refractor.highlight(content, language);
    return renderNodes(tree.children as HastNode[], "t");
  } catch {
    return content;
  }
}
