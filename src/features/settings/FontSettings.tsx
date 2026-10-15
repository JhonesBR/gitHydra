import { useQuery } from "@tanstack/react-query";
import { Select } from "@/components/Select";
import { call } from "@/lib/tauri-client";
import { DEFAULT_FONTS, useFontStore, type FontSettings } from "@/lib/fonts";

const input = "rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-200 outline-none focus:border-blue-500";

function Row({ title, family, size, min, max, sample, mono }: {
  title: string;
  family: keyof FontSettings;
  size: keyof FontSettings;
  min: number;
  max: number;
  sample: string;
  mono?: boolean;
}) {
  const { fonts, set } = useFontStore();
  const { data, error } = useQuery({
    queryKey: ["systemFonts"],
    queryFn: () => call<{ families: string[]; defaultText: string; defaultCode: string }>("list_system_fonts"),
    staleTime: Infinity,
    retry: false,
  });
  const installed = data?.families ?? [];
  const defaultName = (mono ? data?.defaultCode : data?.defaultText) || "";
  const current = fonts[family] as string;
  const options = [
    { value: "", label: defaultName ? `Default (${defaultName})` : "Default" },
    ...(current && !installed.includes(current) ? [{ value: current, label: current }] : []),
    ...installed.map((f) => ({ value: f, label: f })),
  ];
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-neutral-200">{title}</h2>
      <div className="flex items-center gap-2">
        <Select className="flex-1" value={current} options={options} onChange={(v) => set({ [family]: v })} />
        <input
          type="number"
          className={`${input} w-20`}
          min={min}
          max={max}
          value={fonts[size]}
          onChange={(e) => {
            const n = e.currentTarget.valueAsNumber;
            if (n >= min && n <= max) set({ [size]: n });
          }}
        />
        <span className="text-xs text-neutral-500">px</span>
      </div>
      {(error || (data && installed.length === 0)) && (
        <p className="mt-1 text-xs text-amber-500">Could not list the installed fonts: {String(error ?? "none found")}</p>
      )}
      <p className={`mt-2 text-neutral-400 ${mono ? "font-mono" : ""}`}>{sample}</p>
    </div>
  );
}

export function FontSettings() {
  const set = useFontStore((s) => s.set);
  return (
    <div className="mt-8 space-y-5">
      <Row title="Text font" family="textFamily" size="textSize" min={10} max={24} sample="The quick brown fox jumps over the lazy dog" />
      <Row title="Code font" family="codeFamily" size="codeSize" min={8} max={24} mono sample="const sha = 'a1b2c3d'; // 0O 1lI" />
      <p className="text-xs text-neutral-500">
        The text size scales the whole interface. Fonts must be installed on this machine.
      </p>
      <button
        onClick={() => set(DEFAULT_FONTS)}
        className="rounded bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-700"
      >
        Reset fonts to default
      </button>
    </div>
  );
}
