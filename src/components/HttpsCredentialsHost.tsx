import { listen } from "@tauri-apps/api/event";
import { Globe } from "lucide-react";
import { useEffect, useState } from "react";
import { call } from "@/lib/tauri-client";
import { Modal } from "./Modal";

type CredentialsRequest = { host: string; url: string; username: string | null; retry: boolean };

/** Asks for an HTTPS username + password/token when the backend needs one and
 * git's credential helper had none (cached there per host for the session). */
export function HttpsCredentialsHost() {
  const [request, setRequest] = useState<CredentialsRequest | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const show = (r: CredentialsRequest) => {
      setUsername(r.username ?? "");
      setPassword("");
      setRequest(r);
    };
    const unlisten = listen<CredentialsRequest>("https-credentials-request", (e) => show(e.payload));
    // A request made before we were listening only shows up here.
    unlisten.then(() => call<CredentialsRequest | null>("pending_https_credentials")).then((r) => {
      if (r) show(r);
    });
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  if (!request) return null;

  const respond = (answer: { username: string; password: string } | null) => {
    call("submit_https_credentials", { username: answer?.username ?? null, password: answer?.password ?? null });
    setRequest(null);
  };

  const inputClass =
    "w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500";

  return (
    <Modal onClose={() => respond(null)} width="w-[420px]">
      <form
        className="p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (username.trim()) respond({ username: username.trim(), password });
        }}
      >
        <div className="mb-3 flex items-center gap-2">
          <Globe size={16} className="shrink-0 text-blue-500" />
          <h2 className="text-sm font-semibold text-neutral-100">Sign in to {request.host}</h2>
        </div>
        {request.retry && (
          <p className="mb-2 text-xs text-amber-400">Those credentials were rejected. Try again.</p>
        )}
        <p className="mb-3 break-all text-xs text-neutral-500">{request.url}</p>
        <label className="mb-1 block text-xs text-neutral-400">Username</label>
        <input
          autoFocus={!request.username}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={`mb-3 ${inputClass}`}
        />
        <label className="mb-1 block text-xs text-neutral-400">Password or personal access token</label>
        <input
          autoFocus={!!request.username}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={`mb-2 ${inputClass}`}
        />
        <p className="mb-4 text-[11px] text-neutral-500">
          Kept in memory for this session only. Most hosts (GitHub, GitLab) need a token instead of your password.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => respond(null)}
            className="rounded bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!username.trim()}
            className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 hover:bg-neutral-600 disabled:opacity-50"
          >
            Sign in
          </button>
        </div>
      </form>
    </Modal>
  );
}
