/**
 * Performance regression test: replays the deterministic playbook against
 * the local fixture site and asserts that per-step and total timings stay
 * within acceptable bounds.
 *
 * Run with: npx vitest run --config vitest.integration.config.ts -t "benchmark"
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildAgentTools } from "../agent/runtime.js";
import {
  closeBrowser,
  navigateTo,
  replayPlaybook,
} from "../browser/runner.js";
import type { BrowserFn } from "../browser/runner.js";
import { fixtureScenarios, startFixtureSiteServer } from "./site-fixture.js";

/** Maximum allowed total time for the deterministic 16-step playbook. */
const MAX_TOTAL_MS = 25_000;
/** Maximum allowed average time per step. */
const MAX_AVG_STEP_MS = 1_500;

describe("benchmark: replay performance regression", () => {
  const sessionBrowserFns: BrowserFn[] = [];

  afterAll(async () => {
    for (const fn of sessionBrowserFns) {
      await closeBrowser(fn).catch(() => {});
    }
  });

  afterEach(async () => {
    for (const fn of sessionBrowserFns) {
      await closeBrowser(fn).catch(() => {});
    }
    sessionBrowserFns.length = 0;
  });

  it("completes the deterministic playbook within time budget", async () => {
    const server = await startFixtureSiteServer();

    const scenario = fixtureScenarios.find((s) => s.name === "deterministic")!;
    const accumulatedEvents: unknown[] = [];
    const { tools, browserFn } = buildAgentTools(accumulatedEvents, true);
    sessionBrowserFns.push(browserFn);

    await navigateTo(`${server.baseUrl}${scenario.route}`, browserFn);

    const stepTimings: number[] = [];
    const overallStart = performance.now();

    const result = await replayPlaybook(
      scenario.deterministicPlaybook,
      async (step) => {
        const tool = tools.find((t) => t.name === step.tool);
        if (!tool) throw new Error(`Missing tool ${step.tool}`);
        const start = performance.now();
        const res = await tool.execute("bench", step.args as never);
        stepTimings.push(performance.now() - start);
        return (res.content[0] as { text?: string }).text ?? "";
      },
    );

    const totalMs = performance.now() - overallStart;
    const avgStepMs = totalMs / stepTimings.length;

    await server.close();

    // Log timings for visibility in CI output
    console.log(
      `  Replay: ${totalMs.toFixed(0)}ms total, ${avgStepMs.toFixed(0)}ms/step avg, ${stepTimings.length} steps`,
    );

    expect(result.stuckAtIndex).toBe(-1);
    expect(accumulatedEvents.length).toBeGreaterThanOrEqual(4);
    expect(totalMs).toBeLessThan(MAX_TOTAL_MS);
    expect(avgStepMs).toBeLessThan(MAX_AVG_STEP_MS);
  });
});
