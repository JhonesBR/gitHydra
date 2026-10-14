import { Select } from "@/components/Select";
import { useDefaultEditor, useInstalledEditors } from "./useEditorSettings";

const SYSTEM = "__system__";

export function EditorSettings() {
  const { editorId, setEditorId } = useDefaultEditor();
  const { data: editors = [], isPending } = useInstalledEditors();
  const value = editors.some((e) => e.id === editorId) ? editorId! : SYSTEM;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="mb-1 text-sm font-semibold text-neutral-200">Default editor</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Used by "Open in editor" on files. Detected from your PATH and the usual install locations.
        </p>
        <Select
          value={value}
          onChange={(v) => setEditorId(v === SYSTEM ? null : v)}
          options={[
            { value: SYSTEM, label: "System default application" },
            ...editors.map((e) => ({ value: e.id, label: e.name })),
          ]}
        />
        {!isPending && editors.length === 0 && (
          <p className="mt-2 text-xs text-neutral-500">No known editors were found; the system default is used.</p>
        )}
      </div>
    </div>
  );
}
