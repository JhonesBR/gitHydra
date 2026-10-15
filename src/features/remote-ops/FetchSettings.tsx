import { Select } from "@/components/Select";
import { AUTO_FETCH_CHOICES } from "./remotes";
import { useAutoFetchSettings } from "./useAutoFetch";

export function FetchSettings() {
  const { minutes, setMinutes } = useAutoFetchSettings();

  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold text-neutral-200">Automatic fetch</h2>
      <p className="mb-3 text-xs text-neutral-500">
        Fetches every remote of the open repositories in the background, one at a time, while the window is visible.
        It never asks for SSH passphrases or HTTPS credentials: repositories that need them are skipped until you fetch
        or push yourself.
      </p>
      <div className="w-56">
        <Select
          value={String(minutes)}
          onChange={(v) => setMinutes(Number(v))}
          options={AUTO_FETCH_CHOICES.map((m) => ({ value: String(m), label: m === 0 ? "Off" : `Every ${m} minutes` }))}
        />
      </div>
    </div>
  );
}
