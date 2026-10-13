export type GitLabInstance = {
  id: string;
  name: string;
  baseUrl: string;
  token: string;
};

export type IntegrationsSettings = {
  gitlab: { instances: GitLabInstance[] };
};

export type GitLabProject = {
  id: number;
  defaultBranch: string | null;
};

export type MergeRequestInfo = {
  iid: number;
  title: string;
  sourceBranch: string;
  targetBranch: string;
  webUrl: string;
};

export type GitLabUser = {
  id: number;
  username: string;
  name: string;
};

export type GitLabPushData = {
  action: "pushed" | "created" | "removed";
  refType: "branch" | "tag";
  refName: string | null;
  commitCount: number;
  commitTo: string | null;
  commitTitle: string | null;
};

/** One entry of a project's activity feed. */
export type GitLabEvent = {
  id: number;
  /** e.g. "pushed to", "pushed new", "deleted", "opened", "accepted", "commented on". */
  actionName: string;
  /** ISO 8601. */
  createdAt: string;
  authorName: string;
  authorUsername: string;
  authorAvatarUrl: string | null;
  /** "MergeRequest", "Issue", "Note"... null for pushes. */
  targetType: string | null;
  targetTitle: string | null;
  targetIid: number | null;
  push: GitLabPushData | null;
};

export type CreateMergeRequestParams = {
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description: string;
  assigneeId: number | null;
  reviewerIds: number[];
  removeSourceBranch: boolean;
  squash: boolean;
};
