export type BranchInfo = {
  name: string;
  isRemote: boolean;
  isHead: boolean;
  targetSha: string;
};

export type TagInfo = {
  name: string;
  /** The tagged commit (annotated tags already peeled). */
  targetSha: string;
  /** Commit time of the tagged commit (unix seconds). */
  date: number;
};

export type CherryPickResult = {
  conflicts: { path: string }[];
};

export type MergeResult = {
  conflicts: { path: string }[];
};
