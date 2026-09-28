import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Diff, Hunk, parseDiff } from "react-diff-view";
import "react-diff-view/style/index.css";
import { usePersistedValue } from "@/lib/use-persisted-config";
import { getFileContent } from "./api";
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

  let parsed: ReturnType<typeof parseDiff>[number] | null = null;
  if (!file.isBinary) {
    try {
      parsed = parseDiff(file.patch)[0] ?? null;
    } catch {
      parsed = null;
    }
  }

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

      <div className="flex-1 overflow-auto text-sm">
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
          <Diff viewType={viewType} diffType={parsed.type} hunks={parsed.hunks}>
            {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
          </Diff>
        ) : (
          <pre className="whitespace-pre-wrap break-all p-3 font-mono text-xs text-neutral-300">
            {file.patch || "No changes to display."}
          </pre>
        )}
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
