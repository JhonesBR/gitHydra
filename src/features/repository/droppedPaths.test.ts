import { describe, expect, it } from "vitest";
import { droppedRepoPath } from "./droppedPaths";

describe("droppedRepoPath", () => {
  it("takes the first dropped path", () => {
    expect(droppedRepoPath(["/a/repo", "/b/other"])).toBe("/a/repo");
  });
  it("skips blanks and returns null when nothing usable was dropped", () => {
    expect(droppedRepoPath(["", "/a"])).toBe("/a");
    expect(droppedRepoPath([])).toBeNull();
  });
});
