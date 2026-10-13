import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "./format-date";

describe("format-date", () => {
  const d = new Date(2023, 1, 20, 14, 5);
  it("formats day-first", () => {
    expect(formatDate(d)).toBe("20/02/2023");
    expect(formatDateTime(d)).toBe("20/02/2023 14:05");
  });
  it("treats numbers as unix seconds", () => {
    expect(formatDate(d.getTime() / 1000)).toBe("20/02/2023");
  });
});
