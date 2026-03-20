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

  it("excludes TypeScript files outside src/", () => {
    expect(isMutatableSourceFile("lib/schema.ts")).toBe(false);
    expect(isMutatableSourceFile("types/index.ts")).toBe(false);
  });

  it("excludes non-TypeScript files inside src/", () => {
    expect(isMutatableSourceFile("src/runner.js")).toBe(false);
    expect(isMutatableSourceFile("src/data.json")).toBe(false);
  });

  it("excludes TypeScript test files inside src/", () => {
    expect(isMutatableSourceFile("src/agent.test.ts")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isMutatableSourceFile("")).toBe(false);
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
  const baseArgs = ["run", "--coverageAnalysis", "off", "--concurrency", "1"];

  it("builds full-run args when no explicit targets are provided", () => {
    expect(buildStrykerArgs()).toEqual(baseArgs);
  });

  it("does not add --mutate when targets is an empty array", () => {
    expect(buildStrykerArgs([])).toEqual(baseArgs);
    expect(buildStrykerArgs([])).not.toContain("--mutate");
  });

  it("does not add --mutate when targets is undefined", () => {
    expect(buildStrykerArgs(undefined)).toEqual(baseArgs);
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
