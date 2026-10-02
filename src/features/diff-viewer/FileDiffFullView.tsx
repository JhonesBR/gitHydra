import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useMemo, useRef } from "react";
import { Diff, Hunk, markEdits, parseDiff, tokenize } from "react-diff-view";
import type { RenderToken } from "react-diff-view";
import "react-diff-view/style/index.css";
import { guessLanguage, highlightLine } from "@/lib/syntax";
import { usePersistedValue } from "@/lib/use-persisted-config";
import { getFileContent } from "./api";
import { DiffMinimap } from "./DiffMinimap";
import { getImageMime } from "./imageMime";
import type { FileDiff } from "./types";

export function FileDiffFullView({
  repoId,
  sha,
  file,
  onBack,
}: {
  repoId: string;
  sha: string | null;
  file: FileDiff;
  onBack: () => void;
}) {
  const [viewType, setViewType] = usePersistedValue<"unified" | "split">("diff.viewType", "unified");
  const imageMime = file.isBinary ? getImageMime(file.path) : null;
  const scrollRef = useRef<HTMLDivElement>(null);

  let parsed: ReturnType<typeof parseDiff>[number] | null = null;
  if (!file.isBinary) {
    try {
      parsed = parseDiff(file.patch)[0] ?? null;
    } catch {
      parsed = null;
    }
  }

  const language = file.isBinary ? null : guessLanguage(file.path);
  const tokens = useMemo(() => {
    if (!parsed) return undefined;
    try {
      // react-diff-view's own `highlight: true` option is incompatible with
      // installed refractor versions >= 4 (it still expects refractor@3's
      // token shape and throws on the current hast-based one) — syntax
      // coloring is applied ourselves below, via `renderToken`, instead.
      // markEdits still works fine here: it operates on raw text, not tokens.
      return tokenize(parsed.hunks, {
        highlight: false,
        enhancers: [markEdits(parsed.hunks, { type: "block" })],
      });
    } catch {
      return undefined;
    }
  }, [parsed]);

  // Re-applies our own syntax highlighter on top of react-diff-view's plain
  // (unhighlighted) tokens, per token — "text" tokens are a line's untouched
  // portion, "edit" tokens are the specific range markEdits found different
  // from the other side. Highlighting each independently can occasionally
  // split a token (e.g. a string literal) at an edit boundary — an accepted
  // tradeoff for combining word-level diffing with syntax color.
  const renderToken: RenderToken = (token, renderDefault, index) => {
    if (!language) return renderDefault(token, index);
    if (token.type === "text" && typeof token.value === "string") {
      return <span key={index}>{highlightLine(token.value, language)}</span>;
    }
    if (token.type === "edit") {
      const text = ((token.children ?? []) as Array<{ value?: string }>)
        .map((c) => c.value ?? "")
        .join("");
      return (
        <span key={index} className="diff-code-edit">
          {highlightLine(text, language)}
        </span>
      );
    }
    return renderDefault(token, index);
  };

  const { data: imageBase64, isPending: imagePending } = useQuery({
    queryKey: ["fileContent", repoId, sha, file.path],
    queryFn: () => getFileContent(repoId, sha, file.path),
    enabled: !!imageMime,
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-200">
        <span className="min-w-0 truncate">
          {file.oldPath && file.oldPath !== file.path ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        <button
          onClick={onBack}
          className="flex shrink-0 items-center gap-1 rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700"
        >
          <ArrowLeft size={13} /> Back
        </button>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-auto text-sm">
          {imageMime ? (
            imagePending ? (
              <p className="p-3 text-xs text-neutral-500">Loading image...</p>
            ) : imageBase64 ? (
              <div className="flex justify-center p-4">
                <img
                  src={`data:${imageMime};base64,${imageBase64}`}
                  alt={file.path}
                  className="max-w-full rounded border border-neutral-800"
                />
              </div>
            ) : (
              <p className="p-3 text-xs text-neutral-500">{file.path} (unable to load image)</p>
            )
          ) : file.isBinary ? (
            <p className="p-3 text-xs text-neutral-500">{file.path} (binary)</p>
          ) : parsed ? (
            <Diff
              viewType={viewType}
              diffType={parsed.type}
              hunks={parsed.hunks}
              tokens={tokens}
              renderToken={renderToken}
            >
              {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
            </Diff>
          ) : (
            <pre className="whitespace-pre-wrap break-all p-3 font-mono text-xs text-neutral-300">
              {file.patch || "No changes to display."}
            </pre>
          )}
        </div>
        {parsed && !imageMime && <DiffMinimap hunks={parsed.hunks} scrollRef={scrollRef} />}
      </div>

      {!imageMime && (
        <button
          onClick={() => setViewType((v) => (v === "unified" ? "split" : "unified"))}
          className="shrink-0 border-t border-neutral-800 py-2 text-sm text-neutral-400 hover:bg-neutral-900"
        >
          {viewType === "unified" ? "View side by side (split)" : "View unified"}
        </button>
      )}
    </div>
  );
}
