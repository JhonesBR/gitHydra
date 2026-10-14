import { useSignCommits } from "./useSignCommits";

export function SigningSettings() {
  const { signCommits, setSignCommits } = useSignCommits();

  return (
    <div className="space-y-5">
      <div>
        <h2 className="mb-1 text-sm font-semibold text-neutral-200">Commit signing</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Repositories with <code className="text-neutral-400">commit.gpgsign = true</code> are always signed the way
          their git config says (<code className="text-neutral-400">gpg.format</code> ssh or openpgp,{" "}
          <code className="text-neutral-400">user.signingkey</code>), with ssh-keygen or gpg.
        </p>
        <label className="flex items-start gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={signCommits}
            onChange={(e) => setSignCommits(e.currentTarget.checked)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 appearance-none rounded-sm border border-neutral-600 bg-neutral-900 checked:border-emerald-600 checked:bg-emerald-600"
          />
          <span>
            Sign all my commits with SSH
            <span className="block text-xs text-neutral-500">
              Uses each repository's SSH key (SSH Keys tab: repository, then workspace, then default). Your git
              config is not changed. A key with a passphrase is unlocked from ssh-agent, or asked once per session.
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}
