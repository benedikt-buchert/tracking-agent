import { describe, expect, it, vi } from "vitest";
import {
  findCoverageForFile,
  getStagedFiles,
  listSourceFiles,
  parseArgs,
  runCrapReport,
} from "./crap-report.js";

describe("findCoverageForFile", () => {
  it("finds coverage by absolute path, relative path, or normalized relative path", () => {
    const absolute = "/repo/src/example.ts";
    const relative = "src\\example.ts";
    const entry = {
      path: "src/example.ts",
      statementMap: {},
      s: {},
    };

    expect(
      findCoverageForFile({ [absolute]: entry }, absolute, "src/example.ts"),
    ).toBe(entry);
    expect(
      findCoverageForFile(
        { "src/example.ts": entry },
        absolute,
        "src/example.ts",
      ),
    ).toBe(entry);
    expect(findCoverageForFile({ [relative]: entry }, absolute, relative)).toBe(
      entry,
    );
  });
});

describe("listSourceFiles", () => {
  it("walks directories recursively in sorted order", () => {
    const readdirSyncFn = vi.fn((directory: string) => {
      if (directory.endsWith("src")) return ["b.ts", "nested", "a.ts"];
      if (directory.endsWith("nested")) return ["c.ts"];
      return [];
    });
    const statSyncFn = vi.fn((path: string) => ({
      isDirectory: () => path.endsWith("nested"),
    }));

    expect(
      listSourceFiles("/repo/src", readdirSyncFn as never, statSyncFn as never),
    ).toEqual(["/repo/src/a.ts", "/repo/src/b.ts", "/repo/src/nested/c.ts"]);
  });
});

describe("parseArgs", () => {
  it("parses staged files and threshold", () => {
    const execFileSyncFn = vi.fn(() => "src/schema.ts\n");
    const result = parseArgs(
      ["--staged", "--threshold", "30"],
      execFileSyncFn as never,
    );

    expect(result.threshold).toBe(30);
    expect(result.stagedFiles).toEqual(new Set(["src/schema.ts"]));
  });

  it("throws when threshold is missing its value", () => {
    expect(() => parseArgs(["--threshold"])).toThrow(/Missing value/);
  });

  it("ignores unrelated arguments", () => {
    expect(parseArgs(["--unknown", "value"])).toEqual({});
  });
});

describe("getStagedFiles", () => {
  it("returns trimmed non-empty staged paths", () => {
    const execFileSyncFn = vi.fn(() => "src/a.ts\n\n src/b.ts \n");
    expect(getStagedFiles(execFileSyncFn as never)).toEqual(
      new Set(["src/a.ts", "src/b.ts"]),
    );
    expect(execFileSyncFn).toHaveBeenCalledWith(
      "git",
      ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });
});

describe("runCrapReport", () => {
  const coverageJson = JSON.stringify({
    "src/sample.ts": {
      path: "src/sample.ts",
      statementMap: {
        "0": {
          start: { line: 1, column: 0 },
          end: { line: 1, column: 10 },
        },
      },
      s: { "0": 1 },
    },
  });

  it("prints a tabular report for analyzable files", () => {
    const write = vi.fn();
    runCrapReport([], {
      execFileSyncFn: vi.fn(() => "") as never,
      readFileSyncFn: vi.fn((path: string) =>
        path.endsWith("coverage-final.json")
          ? coverageJson
          : "export function sample() { return 1; }",
      ) as never,
      readdirSyncFn: vi.fn(() => ["sample.ts"]) as never,
      statSyncFn: vi.fn(() => ({ isDirectory: () => false })) as never,
      write,
    });

    expect(write).toHaveBeenCalledWith(
      "file\tfunction\tline\tcomplexity\tcoverage\tcrap\n" +
        "src/sample.ts\tsample\t1\t1\t100\t1\n",
    );
  });

  it("prints a friendly message when no analyzable files are selected", () => {
    const write = vi.fn();
    runCrapReport(["--staged"], {
      execFileSyncFn: vi.fn(() => "") as never,
      readFileSyncFn: vi.fn(() => "{}") as never,
      readdirSyncFn: vi.fn(() => ["README.md"]) as never,
      statSyncFn: vi.fn(() => ({ isDirectory: () => false })) as never,
      write,
    });

    expect(write).toHaveBeenCalledWith(
      "No analyzable files selected for CRAP reporting.\n",
    );
  });

  it("does not throw when no reports exceed the threshold", () => {
    expect(() =>
      runCrapReport(["--threshold", "100"], {
        execFileSyncFn: vi.fn(() => "") as never,
        readFileSyncFn: vi.fn((path: string) =>
          path.endsWith("coverage-final.json")
            ? coverageJson
            : "export function sample() { return 1; }",
        ) as never,
        readdirSyncFn: vi.fn(() => ["sample.ts"]) as never,
        statSyncFn: vi.fn(() => ({ isDirectory: () => false })) as never,
        write: vi.fn(),
      }),
    ).not.toThrow();
  });

  it("throws when the selected report exceeds the threshold", () => {
    expect(() =>
      runCrapReport(["--threshold", "0"], {
        execFileSyncFn: vi.fn(() => "") as never,
        readFileSyncFn: vi.fn((path: string) =>
          path.endsWith("coverage-final.json")
            ? coverageJson
            : "export function sample() { return 1; }",
        ) as never,
        readdirSyncFn: vi.fn(() => ["sample.ts"]) as never,
        statSyncFn: vi.fn(() => ({ isDirectory: () => false })) as never,
        write: vi.fn(),
      }),
    ).toThrow(/CRAP threshold 0 exceeded: src\/sample\.ts:1 sample=1/);
  });

  it("filters reports to staged files before printing", () => {
    const coverage = JSON.stringify({
      "src/a.ts": {
        path: "src/a.ts",
        statementMap: {
          "0": {
            start: { line: 1, column: 0 },
            end: { line: 1, column: 10 },
          },
        },
        s: { "0": 1 },
      },
      "src/b.ts": {
        path: "src/b.ts",
        statementMap: {
          "0": {
            start: { line: 1, column: 0 },
            end: { line: 1, column: 20 },
          },
        },
        s: { "0": 1 },
      },
    });
    const write = vi.fn();

    runCrapReport(["--staged"], {
      execFileSyncFn: vi.fn(() => "src/b.ts\n") as never,
      readFileSyncFn: vi.fn((path: string) => {
        if (path.endsWith("coverage-final.json")) return coverage;
        if (path.endsWith("a.ts")) return "export function a() { return 1; }";
        return "export function b(value: boolean) { return value ? 1 : 0; }";
      }) as never,
      readdirSyncFn: vi.fn(() => ["a.ts", "b.ts"]) as never,
      statSyncFn: vi.fn(() => ({ isDirectory: () => false })) as never,
      write,
    });

    expect(write).toHaveBeenCalledWith(
      "file\tfunction\tline\tcomplexity\tcoverage\tcrap\n" +
        "src/b.ts\tb\t1\t2\t100\t2\n",
    );
  });

  it("sorts higher-CRAP reports first", () => {
    const coverage = JSON.stringify({
      "src/a.ts": {
        path: "src/a.ts",
        statementMap: {
          "0": {
            start: { line: 1, column: 0 },
            end: { line: 1, column: 20 },
          },
        },
        s: { "0": 1 },
      },
      "src/b.ts": {
        path: "src/b.ts",
        statementMap: {
          "0": {
            start: { line: 1, column: 0 },
            end: { line: 1, column: 10 },
          },
        },
        s: { "0": 1 },
      },
    });
    const write = vi.fn();

    runCrapReport([], {
      execFileSyncFn: vi.fn(() => "") as never,
      readFileSyncFn: vi.fn((path: string) => {
        if (path.endsWith("coverage-final.json")) return coverage;
        if (path.endsWith("a.ts")) {
          return "export function a(value: boolean) { return value ? 1 : 0; }";
        }
        return "export function b() { return 1; }";
      }) as never,
      readdirSyncFn: vi.fn(() => ["b.ts", "a.ts"]) as never,
      statSyncFn: vi.fn(() => ({ isDirectory: () => false })) as never,
      write,
    });

    expect(write).toHaveBeenCalledWith(
      "file\tfunction\tline\tcomplexity\tcoverage\tcrap\n" +
        "src/a.ts\ta\t1\t2\t100\t2\n" +
        "src/b.ts\tb\t1\t1\t100\t1\n",
    );
  });
});
