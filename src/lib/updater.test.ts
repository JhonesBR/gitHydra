import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));

import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { checkForUpdate, installAndRestart, withTimeout } from "./updater";

describe("withTimeout", () => {
  it("returns the fallback when the promise is too slow", async () => {
    await expect(withTimeout(new Promise(() => {}), 10, "late")).resolves.toBe("late");
  });
  it("returns the value when it arrives in time", async () => {
    await expect(withTimeout(Promise.resolve(1), 1000, 2)).resolves.toBe(1);
  });
});

describe("checkForUpdate", () => {
  it("passes through the plugin's answer and errors", async () => {
    vi.mocked(check).mockResolvedValueOnce(null);
    await expect(checkForUpdate()).resolves.toBeNull();
    vi.mocked(check).mockRejectedValueOnce(new Error("offline"));
    await expect(checkForUpdate()).rejects.toThrow("offline");
  });
});

describe("installAndRestart", () => {
  it("reports download progress as a fraction, then relaunches", async () => {
    const update = {
      downloadAndInstall: async (cb: (e: unknown) => void) => {
        cb({ event: "Started", data: { contentLength: 200 } });
        cb({ event: "Progress", data: { chunkLength: 50 } });
        cb({ event: "Progress", data: { chunkLength: 150 } });
      },
    };
    const seen: (number | null)[] = [];
    await installAndRestart(update as never, (p) => seen.push(p));
    expect(seen).toEqual([null, 0.25, 1]);
    expect(relaunch).toHaveBeenCalled();
  });
});
