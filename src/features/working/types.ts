import type { FileStatus } from "@/features/diff-viewer/types";

export type FileEntry = {
  path: string;
  status: FileStatus;
};

export type WorkingStatus = {
  staged: FileEntry[];
  unstaged: FileEntry[];
};

/** Which list a working-copy file was opened from: its index→workdir diff
 * ("unstaged") or its HEAD→index diff ("staged"). */
export type WorkingSide = "staged" | "unstaged";
