import ts from "typescript";

export interface CoverageLocation {
  line: number;
  column: number;
}

export interface CoverageRange {
  start: CoverageLocation;
  end: CoverageLocation;
}

export interface FileCoverage {
  path: string;
  statementMap: Record<string, CoverageRange>;
  s: Record<string, number>;
}

export interface FunctionReport {
  filePath: string;
  name: string;
  complexity: number;
  statementCoverage: number;
  crap: number;
  startLine: number;
  endLine: number;
}

export function filterReportsByFiles(
  reports: FunctionReport[],
  filePaths: Set<string>,
): FunctionReport[] {
  return reports.filter((report) => filePaths.has(report.filePath));
}

export function findReportsOverThreshold(
  reports: FunctionReport[],
  threshold: number,
): FunctionReport[] {
  return reports.filter((report) => report.crap > threshold);
}

interface FunctionCandidate {
  name: string;
  node:
    | ts.FunctionDeclaration
    | ts.FunctionExpression
    | ts.ArrowFunction
    | ts.MethodDeclaration;
}

export function calculateCrap(
  complexity: number,
  coveragePercent: number,
): number {
  const coverage = Math.max(0, Math.min(100, coveragePercent)) / 100;
  const crap = complexity ** 2 * (1 - coverage) ** 3 + complexity;
  return Number(crap.toFixed(2));
}

export function isAnalyzableSourceFile(filePath: string): boolean {
  return (
    filePath.startsWith("src/") &&
    filePath.endsWith(".ts") &&
    !filePath.endsWith(".test.ts")
  );
}

export function collectFunctionReports(
  filePath: string,
  sourceText: string,
  coverage: FileCoverage,
): FunctionReport[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  return collectFunctionCandidates(sourceFile).map(({ name, node }) => {
    const startLine =
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1;
    const endLine = sourceFile.getLineAndCharacterOfPosition(node.end).line + 1;
    const complexity = computeCyclomaticComplexity(node);
    const statementCoverage = calculateStatementCoverage(
      coverage,
      startLine,
      endLine,
    );

    return {
      filePath,
      name,
      complexity,
      statementCoverage,
      crap: calculateCrap(complexity, statementCoverage),
      startLine,
      endLine,
    };
  });
}

function collectFunctionCandidates(
  sourceFile: ts.SourceFile,
): FunctionCandidate[] {
  const functions: FunctionCandidate[] = [];

  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name) {
      functions.push({ name: node.name.text, node });
    } else if (ts.isMethodDeclaration(node) && node.name) {
      functions.push({ name: node.name.getText(sourceFile), node });
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer)) &&
      ts.isIdentifier(node.name)
    ) {
      functions.push({ name: node.name.text, node: node.initializer });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return functions;
}

function computeCyclomaticComplexity(node: ts.Node): number {
  let complexity = 1;

  function visit(child: ts.Node): void {
    if (
      ts.isIfStatement(child) ||
      ts.isConditionalExpression(child) ||
      ts.isForStatement(child) ||
      ts.isForInStatement(child) ||
      ts.isForOfStatement(child) ||
      ts.isWhileStatement(child) ||
      ts.isDoStatement(child) ||
      ts.isCatchClause(child)
    ) {
      complexity += 1;
    } else if (ts.isCaseClause(child)) {
      complexity += 1;
    } else if (
      ts.isBinaryExpression(child) &&
      (child.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        child.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        child.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      complexity += 1;
    }

    ts.forEachChild(child, visit);
  }

  ts.forEachChild(node, visit);
  return complexity;
}

function calculateStatementCoverage(
  coverage: FileCoverage,
  startLine: number,
  endLine: number,
): number {
  let total = 0;
  let covered = 0;

  for (const [id, location] of Object.entries(coverage.statementMap)) {
    if (!isRangeInside(location, startLine, endLine)) continue;
    total += 1;
    if ((coverage.s[id] ?? 0) > 0) {
      covered += 1;
    }
  }

  if (total === 0) return 0;
  return Number(((covered / total) * 100).toFixed(2));
}

function isRangeInside(
  location: CoverageRange,
  startLine: number,
  endLine: number,
): boolean {
  return location.start.line >= startLine && location.end.line <= endLine;
}
