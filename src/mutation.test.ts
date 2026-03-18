import { describe, expect, it } from "vitest";
import {
  buildStrykerArgs,
  isMutatableSourceFile,
  selectMutationTargets,
} from "./mutation.js";

describe("isMutatableSourceFile", () => {
  it("includes production TypeScript files under src", () => {
    expect(isMutatableSourceFile("src/agent.ts")).toBe(true);
  });

  it("excludes tests and non-source files", () => {
    expect(isMutatableSourceFile("src/agent.test.ts")).toBe(false);
    expect(isMutatableSourceFile("README.md")).toBe(false);
    expect(isMutatableSourceFile("dist/agent.js")).toBe(false);
  });
});

describe("selectMutationTargets", () => {
  it("returns sorted unique mutatable source files", () => {
    expect(
      selectMutationTargets([
        "src/tools.ts",
        "src/agent.test.ts",
        "src/agent.ts",
        "src/tools.ts",
      ]),
    ).toEqual(["src/agent.ts", "src/tools.ts"]);
  });
});

describe("buildStrykerArgs", () => {
  it("builds full-run args when no explicit targets are provided", () => {
    expect(buildStrykerArgs()).toEqual([
      "run",
      "--coverageAnalysis",
      "off",
      "--concurrency",
      "1",
    ]);
  });

  it("adds mutate args for targeted runs", () => {
    expect(buildStrykerArgs(["src/agent.ts", "src/tools.ts"])).toEqual([
      "run",
      "--coverageAnalysis",
      "off",
      "--concurrency",
      "1",
      "--mutate",
      "src/agent.ts,src/tools.ts",
    ]);
  });

  it("can build dry-run-only args for workflow validation", () => {
    expect(buildStrykerArgs(["src/agent.ts"], { dryRunOnly: true })).toEqual([
      "run",
      "--coverageAnalysis",
      "off",
      "--concurrency",
      "1",
      "--dryRunOnly",
      "--mutate",
      "src/agent.ts",
    ]);
  });
});
