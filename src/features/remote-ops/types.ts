export type FetchSummary = {
  remoteName: string;
  receivedObjects: number;
  totalObjects: number;
};

export type PushSummary = {
  remoteName: string;
  branch: string;
};

export type FetchProgressEvent = {
  repoId: string;
  receivedObjects: number;
  totalObjects: number;
  receivedBytes: number;
};

export type PushProgressEvent = {
  repoId: string;
  current: number;
  total: number;
  bytes: number;
};
