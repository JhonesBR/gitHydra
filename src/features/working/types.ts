import type { FileStatus } from "@/features/diff-viewer/types";

export type FileEntry = {
  path: string;
  status: FileStatus;
};

export type WorkingStatus = {
  staged: FileEntry[];
  unstaged: FileEntry[];
};
