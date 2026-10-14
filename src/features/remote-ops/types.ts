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
  /** On-open / periodic fetch: no progress toast. */
  background: boolean;
};

export type RemoteInfo = {
  name: string;
  fetchUrl: string | null;
  /** Only when set apart from the fetch URL. */
  pushUrl: string | null;
};

export type PushProgressEvent = {
  repoId: string;
  current: number;
  total: number;
  bytes: number;
};
