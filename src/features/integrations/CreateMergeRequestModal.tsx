import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { queryKeys } from "@/lib/query-keys";
import { errorMessage } from "@/lib/tauri-client";
import { gitlabCreateMergeRequest, gitlabSearchMembers } from "./api";
import { MemberCombobox } from "./MemberCombobox";
import type { GitLabInstance } from "./types";

export function CreateMergeRequestModal({
  repoId,
  instance,
  projectPath,
  sourceBranch,
  initialTargetBranch,
  onClose,
}: {
  repoId: string;
  instance: GitLabInstance;
  projectPath: string;
  /** The branch being merged — always the repo's current branch, since a
   * merge request is created by right-clicking the branch to merge *into*. */
  sourceBranch: string;
  initialTargetBranch: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const { data: members } = useQuery({
    queryKey: ["gitlabMembers", instance.id, projectPath],
    queryFn: () => gitlabSearchMembers(instance.baseUrl, instance.token, projectPath),
  });

  const [title, setTitle] = useState(sourceBranch);
  const [description, setDescription] = useState("");
  const [targetBranch, setTargetBranch] = useState(initialTargetBranch);
  const [assigneeId, setAssigneeId] = useState<number | null>(null);
  const [reviewerId, setReviewerId] = useState<number | null>(null);
  const [removeSourceBranch, setRemoveSourceBranch] = useState(true);
  const [squash, setSquash] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      gitlabCreateMergeRequest(instance.baseUrl, instance.token, projectPath, {
        sourceBranch,
        targetBranch,
        title,
        description,
        assigneeId,
        reviewerIds: reviewerId !== null ? [reviewerId] : [],
        removeSourceBranch,
        squash,
      }),
    onSuccess: (mr) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.gitlabOpenMrs(repoId) });
      toast.success(`Merge request !${mr.iid} created`);
      openUrl(mr.webUrl);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Modal onClose={onClose}>
      <div className="flex flex-col text-sm">
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-800 px-3 py-2">
          <span className="font-semibold text-neutral-200">Create merge request in GitLab</span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim() || !targetBranch.trim()) return;
            create.mutate();
          }}
          className="max-h-[70vh] space-y-3 overflow-auto p-4"
        >
          <p className="text-xs text-neutral-500">
            Merging <span className="font-mono text-neutral-300">{sourceBranch}</span> into{" "}
            <span className="font-mono text-neutral-300">{targetBranch || "?"}</span>
          </p>
          <label className="block text-xs text-neutral-500">
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
              required
              className="mt-0.5 w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
            />
          </label>
          <label className="block text-xs text-neutral-500">
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
              rows={4}
              className="mt-0.5 w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
            />
          </label>
          <label className="block text-xs text-neutral-500">
            Target branch
            <input
              value={targetBranch}
              onChange={(e) => setTargetBranch(e.currentTarget.value)}
              required
              className="mt-0.5 w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
            />
          </label>
          <div className="flex gap-3">
            <div className="flex-1">
              <span className="block text-xs text-neutral-500">Assignee</span>
              <MemberCombobox selectedId={assigneeId} users={members ?? []} onChange={setAssigneeId} />
            </div>
            <div className="flex-1">
              <span className="block text-xs text-neutral-500">Reviewer</span>
              <MemberCombobox selectedId={reviewerId} users={members ?? []} onChange={setReviewerId} />
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-neutral-400">
            <input
              type="checkbox"
              checked={removeSourceBranch}
              onChange={(e) => setRemoveSourceBranch(e.currentTarget.checked)}
              className="h-3 w-3 shrink-0 appearance-none rounded-sm border border-neutral-600 bg-neutral-900 checked:border-emerald-600 checked:bg-emerald-600"
            />
            Delete source branch when merge request is accepted
          </label>
          <label className="flex items-center gap-1.5 text-xs text-neutral-400">
            <input
              type="checkbox"
              checked={squash}
              onChange={(e) => setSquash(e.currentTarget.checked)}
              className="h-3 w-3 shrink-0 appearance-none rounded-sm border border-neutral-600 bg-neutral-900 checked:border-emerald-600 checked:bg-emerald-600"
            />
            Squash commits when merge request is accepted
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={create.isPending || !title.trim() || !targetBranch.trim()}
              className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-emerald-50 hover:bg-emerald-600 disabled:opacity-50"
            >
              {create.isPending ? "Creating..." : "Create merge request"}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
