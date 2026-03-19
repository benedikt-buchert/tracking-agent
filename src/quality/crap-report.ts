import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  collectFunctionReports,
  filterReportsByFiles,
  findReportsOverThreshold,
  isAnalyzableSourceFile,
} from "./crap.js";

interface IstanbulFileCoverage {
  path: string;
  statementMap: Record<
    string,
    {
      start: { line: number; column: number };
      end: { line: number; column: number };
    }
  >;
  s: Record<string, number>;
}

type CoverageReport = Record<string, IstanbulFileCoverage>;

const ROOT = resolve(import.meta.dirname, "..", "..");
const COVERAGE_PATH = resolve(ROOT, "coverage", "coverage-final.json");

type ExecFileSyncFn = typeof execFileSync;
type ReadFileSyncFn = typeof readFileSync;
type ReaddirSyncFn = typeof readdirSync;
type StatSyncFn = typeof statSync;
type WriteFn = (text: string) => void;

interface CrapReportDependencies {
  execFileSyncFn: ExecFileSyncFn;
  readFileSyncFn: ReadFileSyncFn;
  readdirSyncFn: ReaddirSyncFn;
  statSyncFn: StatSyncFn;
  write: WriteFn;
}

const defaultDependencies: CrapReportDependencies = {
  execFileSyncFn: execFileSync,
  readFileSyncFn: readFileSync,
  readdirSyncFn: readdirSync,
  statSyncFn: statSync,
  write: (text) => {
    process.stdout.write(text);
  },
};

export function runCrapReport(
  argv: string[],
  dependencies: CrapReportDependencies = defaultDependencies,
): void {
  const options = parseArgs(argv, dependencies.execFileSyncFn);
  const coverage = JSON.parse(
    dependencies.readFileSyncFn(COVERAGE_PATH, "utf8"),
  ) as CoverageReport;
  const files = listSourceFiles(
    resolve(ROOT, "src"),
    dependencies.readdirSyncFn,
    dependencies.statSyncFn,
  )
    .map((filePath) => relative(ROOT, filePath))
    .filter(isAnalyzableSourceFile);

  const reports = files.flatMap((filePath) => {
    const absolutePath = resolve(ROOT, filePath);
    const fileCoverage = findCoverageForFile(coverage, absolutePath, filePath);
    if (!fileCoverage) return [];

    const sourceText = dependencies.readFileSyncFn(absolutePath, "utf8");
    return collectFunctionReports(filePath, sourceText, {
      path: filePath,
      statementMap: fileCoverage.statementMap,
      s: fileCoverage.s,
    });
  });

  const selectedReports =
    options.stagedFiles === undefined
      ? reports
      : filterReportsByFiles(reports, options.stagedFiles);
  const sorted = [...selectedReports].sort((a, b) => b.crap - a.crap);

  if (sorted.length === 0) {
    dependencies.write("No analyzable files selected for CRAP reporting.\n");
    return;
  }

  const rows = sorted
    .map((report) =>
      [
        report.filePath,
        report.name,
        String(report.startLine),
        String(report.complexity),
        String(report.statementCoverage),
        String(report.crap),
      ].join("\t"),
    )
    .join("\n");
  dependencies.write(
    ["file\tfunction\tline\tcomplexity\tcoverage\tcrap", rows, ""].join("\n"),
  );

  if (options.threshold !== undefined) {
    const failures = findReportsOverThreshold(sorted, options.threshold);
    if (failures.length > 0) {
      const summary = failures
        .map(
          (report) =>
            `${report.filePath}:${report.startLine} ${report.name}=${report.crap}`,
        )
        .join(", ");
      throw new Error(
        `CRAP threshold ${options.threshold} exceeded: ${summary}`,
      );
    }
  }
}

export function findCoverageForFile(
  coverage: CoverageReport,
  absolutePath: string,
  relativePath: string,
): IstanbulFileCoverage | undefined {
  return (
    coverage[absolutePath] ??
    coverage[relativePath] ??
    coverage[relativePath.replaceAll("\\", "/")]
  );
}

export function listSourceFiles(
  directory: string,
  readdirSyncFn: ReaddirSyncFn = readdirSync,
  statSyncFn: StatSyncFn = statSync,
): string[] {
  const entries = readdirSyncFn(directory).sort();
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry);
    const stats = statSyncFn(entryPath);
    if (stats.isDirectory()) {
      files.push(...listSourceFiles(entryPath, readdirSyncFn, statSyncFn));
    } else {
      files.push(entryPath);
    }
  }

  return files;
}

export function parseArgs(
  argv: string[],
  execFileSyncFn: ExecFileSyncFn = execFileSync,
): {
  stagedFiles?: Set<string>;
  threshold?: number;
} {
  const options: {
    stagedFiles?: Set<string>;
    threshold?: number;
  } = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--staged") {
      options.stagedFiles = getStagedFiles(execFileSyncFn);
    } else if (arg === "--threshold") {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new Error("Missing value for --threshold");
      }
      options.threshold = Number(next);
      i += 1;
    }
  }

  return options;
}

export function getStagedFiles(
  execFileSyncFn: ExecFileSyncFn = execFileSync,
): Set<string> {
  const output = execFileSyncFn(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    { cwd: ROOT, encoding: "utf8" },
  );

  return new Set(
    output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
}

export function main(): void {
  runCrapReport(process.argv.slice(2));
}

if (process.env["VITEST"] !== "true") {
  main();
}
