import { describe, expect, it } from "vitest";
import { wslDistro } from "./wsl";

describe("wslDistro", () => {
  it("reads the distro from WSL UNC paths", () => {
    expect(wslDistro("\\\\wsl.localhost\\Ubuntu\\home\\me\\repo")).toBe("Ubuntu");
    expect(wslDistro("\\\\wsl$\\Debian\\srv")).toBe("Debian");
    expect(wslDistro("//wsl.localhost/Ubuntu/home")).toBe("Ubuntu");
  });

  it("is null for other paths", () => {
    expect(wslDistro("C:\\Users\\me\\repo")).toBeNull();
    expect(wslDistro("/home/me/repo")).toBeNull();
    expect(wslDistro(undefined)).toBeNull();
  });
});
