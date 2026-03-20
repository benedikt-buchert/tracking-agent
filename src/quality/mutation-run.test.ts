import { describe, expect, it, vi } from "vitest";
import { gitOutput, parseArgs, resolveTargets, runMutationCommand } from "./mutation-run.js";

describe("parseArgs", () => {
  it("parses staged and dry-run flags", () => {
    expect(parseArgs(["--staged", "--dry-run-only"])).toEqual({
      staged: true,
      dryRunOnly: true,
    });
  });

  it("parses base and head refs", () => {
    expect(parseArgs(["--base", "origin/main", "--head", "HEAD~1"])).toEqual({
      staged: false,
      baseRef: "origin/main",
      headRef: "HEAD~1",
      dryRunOnly: false,
    });
  });
});

describe("gitOutput", () => {
  it("splits trimmed git output lines", () => {
    const execFileSyncFn = vi.fn(() => "src/a.ts\n\n src/b.ts \n");
    expect(gitOutput(["diff"], execFileSyncFn as never)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
    expect(execFileSyncFn).toHaveBeenCalledWith("git", ["diff"], {
      encoding: "utf8",
    });
  });
});

describe("resolveTargets", () => {
  it("uses base and head refs for diff-based selection", () => {
    const execFileSyncFn = vi.fn(() => "src/schema.ts\nREADME.md\n");
    expect(
      resolveTargets(
        { staged: false, baseRef: "origin/main", headRef: "HEAD", dryRunOnly: false },
        execFileSyncFn as never,
      ),
    ).toEqual(["src/schema.ts"]);
  });

  it("defaults headRef to HEAD when not specified", () => {
    const execFileSyncFn = vi.fn(() => "src/schema.ts\n");
    resolveTargets(
      { staged: false, baseRef: "origin/main", dryRunOnly: false },
      execFileSyncFn as never,
    );
    expect(execFileSyncFn).toHaveBeenCalledWith(
      "git",
      ["diff", "--name-only", "origin/main...HEAD"],
      { encoding: "utf8" },
    );
  });

  it("uses staged diff selection when requested", () => {
    const execFileSyncFn = vi.fn(() => "src/agent/runtime.ts\nsrc/agent/runtime.test.ts\n");
    expect(
      resolveTargets(
        { staged: true, dryRunOnly: false },
        execFileSyncFn as never,
      ),
    ).toEqual(["src/agent/runtime.ts"]);
  });

  it("returns an empty list when no selection mode is enabled", () => {
    expect(resolveTargets({ staged: false, dryRunOnly: false })).toEqual([]);
  });

  it("does not call execFileSyncFn when no selection mode is enabled", () => {
    const execFileSyncFn = vi.fn(() => "");
    resolveTargets({ staged: false, dryRunOnly: false }, execFileSyncFn as never);
    expect(execFileSyncFn).not.toHaveBeenCalled();
  });
});

describe("runMutationCommand", () => {
  it("prints a message and skips stryker when no targets are selected", () => {
    const write = vi.fn();
    const execFileSyncFn = vi.fn(() => "");

    runMutationCommand([], { execFileSyncFn: execFileSyncFn as never, write });

    expect(write).toHaveBeenCalledWith(
      "No changed source files selected for mutation testing.\n",
    );
    expect(execFileSyncFn).not.toHaveBeenCalledWith(
      "./node_modules/.bin/stryker",
      expect.anything(),
      expect.anything(),
    );
  });

  it("runs stryker with targeted args for staged files", () => {
    const write = vi.fn();
    const execFileSyncFn = vi
      .fn()
      .mockReturnValueOnce("src/schema.ts\nsrc/schema.test.ts\n")
      .mockReturnValueOnce("");

    runMutationCommand(["--staged", "--dry-run-only"], {
      execFileSyncFn: execFileSyncFn as never,
      write,
    });

    expect(execFileSyncFn).toHaveBeenNthCalledWith(
      1,
      "git",
      ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
      { encoding: "utf8" },
    );
    expect(execFileSyncFn).toHaveBeenNthCalledWith(
      2,
      "./node_modules/.bin/stryker",
      [
        "run",
        "--coverageAnalysis",
        "off",
        "--concurrency",
        "1",
        "--dryRunOnly",
        "--mutate",
        "src/schema.ts",
      ],
      { stdio: "inherit" },
    );
    expect(write).not.toHaveBeenCalled();
  });
});
