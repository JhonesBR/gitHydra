import type { StashInfo } from "@/features/stash/types";

export type CommitNode = {
  sha: string;
  shortSha: string;
  summary: string;
  body: string;
  authorName: string;
  authorEmail: string;
  authorDate: number;
  committerDate: number;
  parents: string[];
  isMerge: boolean;
};

export type RefInfo = {
  name: string;
  kind: "LocalBranch" | "RemoteBranch" | "Tag" | "DetachedHead";
  targetSha: string;
  isHead: boolean;
};

export type CommitLogPage = {
  commits: CommitNode[];
  refs: RefInfo[];
  nextSkip: number | null;
};

export type GraphSelection =
  | { kind: "commit"; commit: CommitNode }
  | { kind: "commits"; commits: CommitNode[]; fromSha: string; toSha: string }
  | { kind: "wip" }
  | { kind: "stash"; stash: StashInfo }
  | null;
