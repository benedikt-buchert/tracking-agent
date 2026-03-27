#!/usr/bin/env node
/**
 * CLI entry point for running a single harness case.
 *
 * Usage:
 *   npx tsx src/harness/run-case.ts harness/cases/local-discovery-01.json [options]
 *
 * Options:
 *   --lane <lane>         Run lane (default: discovery_known)
 *   --headed              Run with headed browser (default: headless)
 *   --results-dir <dir>   Directory for run-result JSON (default: harness/results)
 *   --baseline <file>     Optional human-baseline JSON file
 *   --schema-url <url>    Schema URL (default: tracking-docs-demo.buchert.digital)
 */

import { resolve } from "path";
import { loadCase, loadHumanBaseline } from "./loader.js";
import { runCase, createProductionDeps } from "./runner.js";
import { buildScorecard, formatScorecard } from "./scorecard.js";
import type { RunLane } from "./types.js";

const VALID_LANES = new Set<RunLane>([
  "discovery_known",
  "discovery_promoted",
  "discovery_live_target",
  "discovery_live_holdout",
]);

function parseArgs(argv: string[]): {
  casePath: string;
  lane: RunLane;
  headed: boolean;
  resultsDir: string;
  baselinePath?: string;
  schemaUrl?: string;
} {
  const args = argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    process.stderr.write(
      "Usage: npx tsx src/harness/run-case.ts <case.json> [--lane <lane>] [--headed] [--results-dir <dir>] [--baseline <file>] [--schema-url <url>]\n",
    );
    process.exit(0);
  }

  const casePath = args[0]!;
  let lane: RunLane = "discovery_known";
  let headed = false;
  let resultsDir = "harness/results";
  let baselinePath: string | undefined;
  let schemaUrl: string | undefined;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--headed") {
      headed = true;
    } else if (arg === "--lane" && args[i + 1]) {
      const candidate = args[++i]!;
      if (!VALID_LANES.has(candidate as RunLane)) {
        process.stderr.write(
          `Invalid lane: ${candidate}. Valid lanes: ${[...VALID_LANES].join(", ")}\n`,
        );
        process.exit(1);
      }
      lane = candidate as RunLane;
    } else if (arg === "--results-dir" && args[i + 1]) {
      resultsDir = args[++i]!;
    } else if (arg === "--baseline" && args[i + 1]) {
      baselinePath = args[++i]!;
    } else if (arg === "--schema-url" && args[i + 1]) {
      schemaUrl = args[++i]!;
    }
  }

  return { casePath, lane, headed, resultsDir, baselinePath, schemaUrl };
}

async function main(): Promise<void> {
  const { casePath, lane, headed, resultsDir, baselinePath, schemaUrl } =
    parseArgs(process.argv);

  const resolvedCasePath = resolve(casePath);
  process.stderr.write(`Loading case: ${resolvedCasePath}\n`);

  const testCase = await loadCase(resolvedCasePath);
  process.stderr.write(`Case: ${testCase.case_id} (${testCase.kind}) — ${testCase.entry_url}\n`);

  const humanBaseline = baselinePath
    ? await loadHumanBaseline(resolve(baselinePath))
    : undefined;

  if (humanBaseline) {
    process.stderr.write(`Baseline: ${humanBaseline.human_baseline_id} (${humanBaseline.action_steps_total} steps)\n`);
  }

  const deps = await createProductionDeps();

  process.stderr.write(`Running case with lane: ${lane}...\n`);
  const result = await runCase(testCase, deps, {
    headless: !headed,
    lane,
    resultsDir: resolve(resultsDir),
    humanBaseline,
    schemaUrl,
  });

  const scorecard = buildScorecard([result]);
  process.stdout.write(formatScorecard(scorecard));

  process.exit(result.outcome.status === "passed" ? 0 : 1);
}

main().catch((err: unknown) => {
  process.stderr.write(`Fatal error: ${String(err)}\n`);
  process.exit(1);
});
