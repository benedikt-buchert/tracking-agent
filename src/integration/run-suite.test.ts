import { describe, expect, it } from "vitest";
import { resolve } from "path";
import { resolveCommand } from "./run-suite.js";

describe("resolveCommand", () => {
  it("prefers a local node_modules binary for bare commands", () => {
    const root = resolve(import.meta.dirname, "..", "..");
    const expected = resolve(root, "node_modules", ".bin", "vitest");

    const resolved = resolveCommand("vitest", {
      cwd: root,
      existsSyncFn: (path) => path === expected,
    });

    expect(resolved).toBe(expected);
  });

  it("leaves commands with a path unchanged", () => {
    expect(
      resolveCommand("./scripts/custom-runner", {
        existsSyncFn: () => false,
      }),
    ).toBe("./scripts/custom-runner");
  });

  it("leaves bare commands unchanged when no local binary exists", () => {
    expect(
      resolveCommand("vitest", {
        cwd: "/tmp/project",
        existsSyncFn: () => false,
      }),
    ).toBe("vitest");
  });
});
