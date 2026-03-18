import { describe, expect, it } from "vitest";
import {
  calculateCrap,
  collectFunctionReports,
  filterReportsByFiles,
  findReportsOverThreshold,
  isAnalyzableSourceFile,
} from "./crap.js";

describe("calculateCrap", () => {
  it("returns raw complexity for fully covered code", () => {
    expect(calculateCrap(5, 100)).toBe(5);
  });

  it("penalizes uncovered complex code", () => {
    expect(calculateCrap(5, 0)).toBe(30);
  });

  it("uses partial coverage in the CRAP formula", () => {
    expect(calculateCrap(4, 50)).toBe(6);
  });
});

describe("isAnalyzableSourceFile", () => {
  it("includes non-test TypeScript source files under src", () => {
    expect(isAnalyzableSourceFile("src/runner.ts")).toBe(true);
  });

  it("excludes tests, dist output, and non-TypeScript files", () => {
    expect(isAnalyzableSourceFile("src/runner.test.ts")).toBe(false);
    expect(isAnalyzableSourceFile("dist/runner.js")).toBe(false);
    expect(isAnalyzableSourceFile("README.md")).toBe(false);
  });
});

describe("collectFunctionReports", () => {
  it("computes complexity, statement coverage, and CRAP score per function", () => {
    const sourceText = `
export function sample(flag: boolean, items: number[]) {
  if (flag && items.length > 0) {
    return items[0];
  }
  return 0;
}
`;

    const reports = collectFunctionReports("src/sample.ts", sourceText, {
      path: "src/sample.ts",
      statementMap: {
        "0": {
          start: { line: 2, column: 0 },
          end: { line: 4, column: 3 },
        },
        "1": {
          start: { line: 5, column: 2 },
          end: { line: 5, column: 11 },
        },
      },
      s: { "0": 1, "1": 0 },
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      name: "sample",
      complexity: 3,
      statementCoverage: 50,
      crap: 4.13,
    });
  });

  it("treats functions without statements as uncovered", () => {
    const sourceText = `
export function noop() {}
`;

    const reports = collectFunctionReports("src/noop.ts", sourceText, {
      path: "src/noop.ts",
      statementMap: {},
      s: {},
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      name: "noop",
      complexity: 1,
      statementCoverage: 0,
      crap: 2,
    });
  });
});

describe("report filtering", () => {
  const reports = [
    {
      filePath: "src/agent.ts",
      name: "main",
      complexity: 8,
      statementCoverage: 50,
      crap: 16,
      startLine: 1,
      endLine: 10,
    },
    {
      filePath: "src/schema.ts",
      name: "extractRefs",
      complexity: 4,
      statementCoverage: 100,
      crap: 4,
      startLine: 1,
      endLine: 10,
    },
  ];

  it("filters reports to a selected file set", () => {
    expect(filterReportsByFiles(reports, new Set(["src/schema.ts"]))).toEqual([
      reports[1],
    ]);
  });

  it("returns reports over a CRAP threshold", () => {
    expect(findReportsOverThreshold(reports, 10)).toEqual([reports[0]]);
  });
});
