export type WorkspaceEntry = {
  id: string;
  name: string;
  path: string;
  ignoredPaths: string[];
  /** Overrides the active profile for repos in this workspace; null = use the selected one. */
  profileId: string | null;
};

export type WorkspaceRepoEntry = {
  name: string;
  path: string;
};
