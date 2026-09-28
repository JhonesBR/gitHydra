import { useIsMutating } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useStashActions } from "./useStashActions";

export function StashPopoverContent({ repoId }: { repoId: string }) {
  const [message, setMessage] = useState("");
  const anyMutating = useIsMutating() > 0;
  const { stashes, save: saveMutation, pop: popMutation } = useStashActions(repoId);

  return (
    <div className="flex flex-col gap-2 text-sm">
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate(
            { message: message.trim() || null, includeUntracked: false },
            { onSuccess: () => setMessage("") },
          );
        }}
      >
        <input
          autoFocus
          value={message}
          onChange={(e) => setMessage(e.currentTarget.value)}
          placeholder="stash message..."
          className="min-w-0 flex-1 rounded bg-neutral-800 px-2 py-1 text-neutral-100"
        />
        <button
          type="submit"
          disabled={anyMutating}
          className="flex shrink-0 items-center gap-1 rounded bg-neutral-700 px-2 py-1 text-xs hover:bg-neutral-600 disabled:opacity-50"
        >
          {saveMutation.isPending && <Loader2 size={11} className="animate-spin" />} Save
        </button>
      </form>

      <ul className="max-h-48 overflow-auto">
        {stashes?.map((stash) => (
          <li
            key={stash.index}
            className="flex items-center justify-between gap-2 rounded px-1 py-1 text-neutral-200 hover:bg-neutral-800"
          >
            <span className="min-w-0 flex-1 truncate">{stash.message}</span>
            <button
              onClick={() => popMutation.mutate(stash.index)}
              disabled={anyMutating}
              className="flex shrink-0 items-center gap-1 rounded bg-neutral-700 px-1.5 py-0.5 text-xs hover:bg-neutral-600 disabled:opacity-50"
            >
              {popMutation.isPending && popMutation.variables === stash.index && (
                <Loader2 size={10} className="animate-spin" />
              )}{" "}
              pop
            </button>
          </li>
        ))}
        {stashes?.length === 0 && <li className="px-1 py-1 text-neutral-500">no stashes</li>}
      </ul>
    </div>
  );
}
