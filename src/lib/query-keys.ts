export const queryKeys = {
  commitLog: (repoId: string) => ["commitLog", repoId] as const,
  commitDiff: (repoId: string, sha: string) => ["commitDiff", repoId, sha] as const,
  rangeDiff: (repoId: string, fromSha: string, toSha: string) =>
    ["rangeDiff", repoId, fromSha, toSha] as const,
  branches: (repoId: string) => ["branches", repoId] as const,
  repoStatus: (repoId: string) => ["repoStatus", repoId] as const,
  stashes: (repoId: string) => ["stashes", repoId] as const,
  workingStatus: (repoId: string) => ["workingStatus", repoId] as const,
  workdirDiff: (repoId: string, staged: boolean) => ["workdirDiff", repoId, staged] as const,
};
