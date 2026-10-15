import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

export function SecretInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const btn = "rounded p-1 text-neutral-400 hover:text-neutral-100";
  return (
    <span className="mt-0.5 flex items-center gap-1">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={placeholder}
        className="w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
      />
      {visible && (
        <button
          type="button"
          title="Copy"
          className={btn}
          onClick={() => {
            void navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      )}
      <button
        type="button"
        title={visible ? "Hide" : "Show"}
        className={btn}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </span>
  );
}
