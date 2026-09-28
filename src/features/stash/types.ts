export type StashInfo = {
  index: number;
  message: string;
  sha: string;
  baseSha: string;
};

export type StashPopResult = {
  conflicts: { path: string }[];
};
