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
