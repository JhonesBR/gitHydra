import { describe, expect, it } from "vitest";
import { favoritesFirst, isFavorite, toggleFavorite } from "./favorites";

describe("favorites", () => {
  it("toggles a path on and off", () => {
    const on = toggleFavorite([], "/a/b");
    expect(on).toEqual(["/a/b"]);
    expect(toggleFavorite(on, "/a/b")).toEqual([]);
  });

  it("matches paths whatever the separators or trailing slash", () => {
    expect(isFavorite(["C:\\code\\app"], "C:/code/app/")).toBe(true);
    expect(toggleFavorite(["/a/b/"], "/a/b")).toEqual([]);
  });

  it("puts favorites first and keeps the order within each group", () => {
    const items = [{ path: "/1" }, { path: "/2" }, { path: "/3" }];
    expect(favoritesFirst(items, ["/3", "/1"]).map((i) => i.path)).toEqual(["/1", "/3", "/2"]);
  });
});
