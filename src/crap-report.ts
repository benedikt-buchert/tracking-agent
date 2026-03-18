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

const ROOT = resolve(import.meta.dirname, "..");
const COVERAGE_PATH = resolve(ROOT, "coverage", "coverage-final.json");

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const coverage = JSON.parse(
    readFileSync(COVERAGE_PATH, "utf8"),
  ) as CoverageReport;
  const files = listSourceFiles(resolve(ROOT, "src"))
    .map((filePath) => relative(ROOT, filePath))
    .filter(isAnalyzableSourceFile);

  const reports = files.flatMap((filePath) => {
    const absolutePath = resolve(ROOT, filePath);
    const fileCoverage = findCoverageForFile(coverage, absolutePath, filePath);
    if (!fileCoverage) return [];

    const sourceText = readFileSync(absolutePath, "utf8");
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
    console.log("No analyzable files selected for CRAP reporting.");
    return;
  }

  console.table(
    sorted.map((report) => ({
      file: report.filePath,
      function: report.name,
      line: report.startLine,
      complexity: report.complexity,
      coverage: report.statementCoverage,
      crap: report.crap,
    })),
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

function findCoverageForFile(
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

function listSourceFiles(directory: string): string[] {
  const entries = readdirSync(directory).sort();
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry);
    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      files.push(...listSourceFiles(entryPath));
    } else {
      files.push(entryPath);
    }
  }

  return files;
}

function parseArgs(argv: string[]): {
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
      options.stagedFiles = getStagedFiles();
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

function getStagedFiles(): Set<string> {
  const output = execFileSync(
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

main();
