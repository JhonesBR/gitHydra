export type WorkspaceEntry = {
  id: string;
  name: string;
  path: string;
  ignoredPaths: string[];
};

export type WorkspaceRepoEntry = {
  name: string;
  path: string;
};
