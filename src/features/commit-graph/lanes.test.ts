import { describe, expect, it } from "vitest";
import { computeLanes } from "./lanes";
import type { CommitNode } from "./types";

function commit(sha: string, parents: string[]): CommitNode {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    summary: sha,
    body: "",
    authorName: "test",
    authorEmail: "test@example.com",
    authorDate: 0,
    committerDate: 0,
    parents,
    isMerge: parents.length > 1,
  };
}

describe("computeLanes", () => {
  it("keeps a straight line of commits on a single lane", () => {
    const rows = computeLanes([
      commit("c3", ["c2"]),
      commit("c2", ["c1"]),
      commit("c1", []),
    ]);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
  });

  it("handles a root commit with no parents", () => {
    const rows = computeLanes([commit("c1", [])]);
    expect(rows[0].parentConnections).toEqual([]);
  });

  it("opens a second lane for a merge commit and closes it after both parents are consumed", () => {
    const rows = computeLanes([
      commit("merge", ["c1", "c2"]),
      commit("c1", []),
      commit("c2", []),
    ]);
    expect(rows[0].lane).toBe(0);
    expect(rows[0].parentConnections).toEqual([
      { toLane: 0, toRowIndex: 1, kind: "direct" },
      { toLane: 1, toRowIndex: 2, kind: "merge" },
    ]);
    expect(rows[1].lane).toBe(0); // c1
    expect(rows[2].lane).toBe(1); // c2
  });

  it("supports octopus merges with 3+ parents", () => {
    const rows = computeLanes([
      commit("merge", ["c1", "c2", "c3"]),
      commit("c1", []),
      commit("c2", []),
      commit("c3", []),
    ]);
    expect(rows[0].parentConnections.map((p) => p.toLane)).toEqual([0, 1, 2]);
    expect(rows.slice(1).map((r) => r.lane)).toEqual([0, 1, 2]);
  });

  it("collapses two lanes that converge on the same ancestor without a merge commit", () => {
    const rows = computeLanes([
      commit("tipA", ["base"]),
      commit("tipB", ["base"]),
      commit("base", []),
      commit("next-root", []),
    ]);
    expect(rows[0].lane).toBe(0); // tipA
    expect(rows[1].lane).toBe(1); // tipB
    expect(rows[2].lane).toBe(0); // base, collapses both lanes
    expect(rows[3].lane).toBe(0); // a freed lane is reused instead of opening lane 2

    // Both children must connect to wherever `base` actually ends up (lane 0),
    // even the one (tipB) that was sitting in a different lane (1).
    expect(rows[0].parentConnections).toEqual([{ toLane: 0, toRowIndex: 2, kind: "direct" }]);
    expect(rows[1].parentConnections).toEqual([{ toLane: 0, toRowIndex: 2, kind: "direct" }]);
  });

  it("draws a branch-point commit's edge correctly for every child, not just the first", () => {
    // b (child of shared) sits at row 0/lane 0; a (also a child of shared) sits
    // at row 1/lane 1 because b already occupies lane 0 at that point. Both
    // must still connect to `shared`, which ends up in lane 0.
    const rows = computeLanes([
      commit("b", ["shared"]),
      commit("a", ["shared"]),
      commit("shared", ["root"]),
      commit("root", []),
    ]);
    expect(rows[1].lane).toBe(1); // a opened a second lane since b already holds lane 0
    expect(rows[1].parentConnections).toEqual([{ toLane: 0, toRowIndex: 2, kind: "direct" }]);
    expect(rows[0].parentConnections).toEqual([{ toLane: 0, toRowIndex: 2, kind: "direct" }]);
  });

  it("marks a parent outside the loaded page with toRowIndex -1", () => {
    const rows = computeLanes([commit("tip", ["not-loaded"])]);
    expect(rows[0].parentConnections).toEqual([
      { toLane: 0, toRowIndex: -1, kind: "direct" },
    ]);
  });
});
