/**
 * Benchmark: replays playbooks against all fixture scenarios and reports
 * per-step timing, totals, and event capture results.
 *
 * Usage: npx tsx src/integration/bench-replay.ts
 *
 * Covers:
 *  - deterministic: happy path, all steps succeed
 *  - mutated: playbook gets stuck (measures stuck detection speed)
 *  - ephemeral: same playbook, ephemeral dataLayer mode (tests cross-page recovery)
 */
import chalk from "chalk";
import { buildAgentTools } from "../agent/runtime.js";
import { closeBrowser, navigateTo, replayPlaybook } from "../browser/runner.js";
import {
  type FixtureScenario,
  fixtureScenarios,
  startFixtureSiteServer,
} from "./site-fixture.js";

interface StepTiming {
  step: string;
  ms: number;
}

interface ScenarioResult {
  name: string;
  stepTimings: StepTiming[];
  totalMs: number;
  eventsFound: number;
  stuckAtIndex: number;
}

async function benchScenario(
  scenario: FixtureScenario,
  baseUrl: string,
): Promise<ScenarioResult> {
  const accumulatedEvents: unknown[] = [];
  const { tools, browserFn } = buildAgentTools(accumulatedEvents, true);

  await navigateTo(`${baseUrl}${scenario.route}`, browserFn);

  const stepTimings: StepTiming[] = [];
  const overallStart = performance.now();

  const result = await replayPlaybook(
    scenario.deterministicPlaybook,
    async (step) => {
      const tool = tools.find((t) => t.name === step.tool);
      if (!tool) throw new Error(`Missing tool ${step.tool}`);

      const label = `${step.tool} ${JSON.stringify(step.args)}`.slice(0, 80);
      const start = performance.now();
      const res = await tool.execute("bench", step.args as never);
      const elapsed = performance.now() - start;
      stepTimings.push({ step: label, ms: elapsed });

      return (res.content[0] as { text?: string }).text ?? "";
    },
  );

  const totalMs = performance.now() - overallStart;

  await closeBrowser(browserFn).catch(() => {});

  return {
    name: scenario.name,
    stepTimings,
    totalMs,
    eventsFound: accumulatedEvents.length,
    stuckAtIndex: result.stuckAtIndex,
  };
}

function printResult(result: ScenarioResult) {
  const statusIcon =
    result.stuckAtIndex === -1 ? chalk.green("✓") : chalk.yellow("⚠");
  console.log(
    chalk.bold(`\n── ${statusIcon} ${result.name} ──\n`),
  );

  for (const { step, ms } of result.stepTimings) {
    const color =
      ms > 1000 ? chalk.red : ms > 500 ? chalk.yellow : chalk.green;
    console.log(`  ${color(`${ms.toFixed(0).padStart(5)}ms`)}  ${step}`);
  }

  const stuckLabel =
    result.stuckAtIndex === -1
      ? chalk.green("none")
      : chalk.yellow(`step ${result.stuckAtIndex}`);

  console.log(
    chalk.bold(
      `\n  Total: ${result.totalMs.toFixed(0)}ms  (${result.stepTimings.length} steps)`,
    ),
  );
  console.log(`  Events captured: ${result.eventsFound}`);
  console.log(`  Stuck at: ${stuckLabel}`);
}

function printSummary(results: ScenarioResult[]) {
  console.log(chalk.bold("\n══ Summary ══\n"));

  const maxNameLen = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const status =
      r.stuckAtIndex === -1 ? chalk.green("pass") : chalk.yellow("stuck");
    const avgStep = r.totalMs / r.stepTimings.length;
    console.log(
      `  ${r.name.padEnd(maxNameLen)}  ${status}  ${r.totalMs.toFixed(0).padStart(6)}ms total  ${avgStep.toFixed(0).padStart(4)}ms/step  ${r.eventsFound} events`,
    );
  }
  console.log();
}

async function run() {
  const server = await startFixtureSiteServer();
  const results: ScenarioResult[] = [];

  for (const scenario of fixtureScenarios) {
    results.push(await benchScenario(scenario, server.baseUrl));
  }

  for (const result of results) {
    printResult(result);
  }
  printSummary(results);

  await server.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
