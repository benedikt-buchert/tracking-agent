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

  it("clamps coverage above 100 percent", () => {
    expect(calculateCrap(4, 120)).toBe(4);
  });

  it("clamps coverage below 0 percent", () => {
    expect(calculateCrap(4, -10)).toBe(20);
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

  it("excludes TypeScript files outside src and non-ts files inside src", () => {
    expect(isAnalyzableSourceFile("lib/schema.ts")).toBe(false);
    expect(isAnalyzableSourceFile("src/schema.js")).toBe(false);
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

  it("collects named variable functions and methods with in-range coverage only", () => {
    const sourceText = `
const helper = () => 1;
class Example {
  method(flag: boolean) {
    return flag ? 1 : 0;
  }
}
`;

    const reports = collectFunctionReports("src/example.ts", sourceText, {
      path: "src/example.ts",
      statementMap: {
        "0": {
          start: { line: 2, column: 0 },
          end: { line: 2, column: 22 },
        },
        "1": {
          start: { line: 4, column: 4 },
          end: { line: 4, column: 24 },
        },
        "2": {
          start: { line: 10, column: 0 },
          end: { line: 10, column: 5 },
        },
      },
      s: { "0": 1, "1": 0, "2": 1 },
    });

    expect(reports).toHaveLength(2);
    expect(reports).toEqual([
      expect.objectContaining({
        name: "helper",
        startLine: 2,
        endLine: 2,
        statementCoverage: 100,
      }),
      expect.objectContaining({
        name: "method",
        complexity: 2,
        startLine: 4,
        endLine: 6,
        statementCoverage: 0,
      }),
    ]);
  });

  it("counts || operators toward cyclomatic complexity", () => {
    const sourceText = `
function either(a: boolean, b: boolean) {
  return a || b;
}
`;
    const reports = collectFunctionReports("src/either.ts", sourceText, {
      path: "src/either.ts",
      statementMap: {
        "0": {
          start: { line: 3, column: 2 },
          end: { line: 3, column: 15 },
        },
      },
      s: { "0": 1 },
    });

    expect(reports).toEqual([
      expect.objectContaining({
        name: "either",
        complexity: 2,
      }),
    ]);
  });

  it("counts case clauses and logical operators toward cyclomatic complexity", () => {
    const sourceText = `
const advanced = (value: number | null) => {
  switch (value) {
    case 1:
      return value ?? 0;
    default:
      return value && value > 0 ? value : 0;
  }
};
`;

    const reports = collectFunctionReports("src/advanced.ts", sourceText, {
      path: "src/advanced.ts",
      statementMap: {
        "0": {
          start: { line: 4, column: 6 },
          end: { line: 4, column: 23 },
        },
        "1": {
          start: { line: 6, column: 6 },
          end: { line: 6, column: 39 },
        },
      },
      s: { "0": 1, "1": 1 },
    });

    expect(reports).toEqual([
      expect.objectContaining({
        name: "advanced",
        complexity: 5,
        statementCoverage: 100,
      }),
    ]);
  });

  it("supports function expressions assigned to variables", () => {
    const sourceText = `
const expression = function named(value: boolean) {
  return value ? 1 : 0;
};
`;

    const reports = collectFunctionReports("src/expression.ts", sourceText, {
      path: "src/expression.ts",
      statementMap: {
        "0": {
          start: { line: 2, column: 2 },
          end: { line: 2, column: 24 },
        },
      },
      s: { "0": 1 },
    });

    expect(reports).toEqual([
      expect.objectContaining({
        name: "expression",
        complexity: 2,
      }),
    ]);
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

  it("excludes reports with CRAP score exactly equal to the threshold", () => {
    expect(findReportsOverThreshold(reports, 4)).toEqual([reports[0]]);
  });
});
