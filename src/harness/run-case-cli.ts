#!/usr/bin/env node
/**
 * Minimal CLI to run a single harness case by file path or case_id.
 * Usage: npx tsx src/harness/run-case-cli.ts harness/cases/hirmer-stage-purchase-01.json
 */
import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve, join } from "path";
import { runStagehandCase } from "./stagehand-runner.js";
import type { SignalBackedCase } from "./types.js";

process.loadEnvFile?.();

const casePath = process.argv[2];
if (!casePath) {
  process.stderr.write("Usage: run-case-cli <case-file.json>\n");
  process.exit(1);
}

const raw = await readFile(resolve(casePath), "utf8");
const testCase = JSON.parse(raw) as SignalBackedCase;
const headless = process.argv.includes("--headless");

process.stderr.write(`Running case: ${testCase.case_id}\n`);
process.stderr.write(`URL: ${testCase.entry_url}\n`);
process.stderr.write(`Headless: ${headless}\n\n`);

const result = await runStagehandCase(testCase, { headless });

process.stderr.write(`\n--- Results ---\n`);
process.stderr.write(`Action steps: ${result.actionStepsTotal}\n`);
process.stderr.write(`Journey completed: ${result.journeyCompleted}\n`);
process.stderr.write(`Events captured: ${result.accumulatedEvents.length}\n\n`);

const eventNames = result.accumulatedEvents
  .map((e) =>
    e && typeof e === "object"
      ? (e as Record<string, unknown>)["event"]
      : undefined,
  )
  .filter(Boolean);

process.stderr.write(`Event names: ${[...new Set(eventNames)].join(", ")}\n\n`);

const outPath = join(
  "harness",
  "results",
  `${new Date().toISOString().replace(/[:.]/g, "-")}-${testCase.case_id}.json`,
);
await mkdir("harness/results", { recursive: true });
await writeFile(
  outPath,
  JSON.stringify(
    {
      case_id: testCase.case_id,
      timestamp: new Date().toISOString(),
      metrics: {
        action_steps_total: result.actionStepsTotal,
        tool_calls_total: result.toolCallsTotal,
        events_captured: result.accumulatedEvents.length,
      },
      journey_completed: result.journeyCompleted,
      events: result.accumulatedEvents,
    },
    null,
    2,
  ),
  "utf8",
);
process.stderr.write(`Result saved → ${outPath}\n`);
process.stdout.write(JSON.stringify(result.accumulatedEvents, null, 2) + "\n");
