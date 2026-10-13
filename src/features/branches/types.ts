export type BranchInfo = {
  name: string;
  isRemote: boolean;
  isHead: boolean;
  targetSha: string;
};

export type CherryPickResult = {
  conflicts: { path: string }[];
};

export type MergeResult = {
  conflicts: { path: string }[];
};
