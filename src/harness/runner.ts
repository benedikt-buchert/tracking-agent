import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { SignalBackedCase, HumanBaseline, RunResult, RunLane } from "./types.js";
import { isActionStep } from "./step-counter.js";
import { gradeRun } from "./grader.js";

const execFileAsync = promisify(execFile);

// ─── Dependency injection interface ──────────────────────────────────────────

export interface RunCaseDeps {
  openBrowser: (url: string, headless: boolean) => Promise<void>;
  closeBrowser: () => Promise<void>;
  captureFinalEvents: (events: unknown[]) => Promise<unknown[]>;
  runInteractiveMode: (
    schemaUrl: string,
    targetUrl: string,
    eventSchemas: unknown[],
    savedMessages: unknown[],
    resume: boolean,
    agentTools: unknown,
    accumulatedEvents: unknown[],
    foundEventNames: string[],
    skippedEvents: { name: string; reason: string }[],
    credentialsSummary: string,
    log: unknown,
  ) => Promise<void>;
  buildAgentTools: (
    accumulatedEvents: unknown[],
    headless: boolean,
  ) => { tools: unknown; browserFn: unknown; sessionId: string };
  discoverEventSchemas: (schemaUrl: string, target: string) => Promise<unknown[]>;
  createAgent: () => { subscribe: (cb: (event: unknown) => void) => () => void };
  writeResult: (path: string, result: RunResult) => Promise<void>;
  getGitCommit: () => Promise<string>;
  getAccumulatedEvents: () => unknown[];
}

export interface RunCaseOptions {
  headless: boolean;
  lane: RunLane;
  resultsDir: string;
  humanBaseline?: HumanBaseline;
  schemaUrl?: string;
}

// ─── Default implementations ─────────────────────────────────────────────────

async function defaultGetGitCommit(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"]);
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

async function defaultWriteResult(path: string, result: RunResult): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(result, null, 2), "utf-8");
}

// ─── Run result path ─────────────────────────────────────────────────────────

function buildResultPath(resultsDir: string, caseId: string, timestamp: string): string {
  const safe = timestamp.replace(/[:.]/g, "-");
  return join(resultsDir, `${safe}-${caseId}.json`);
}

// ─── Helper: extract event metrics ───────────────────────────────────────────

function extractEventMetrics(events: unknown[]): {
  events_extracted_total: number;
  unique_event_names: number;
  observed_event_names: string[];
} {
  const names: string[] = [];
  for (const e of events) {
    if (e && typeof e === "object") {
      const name = (e as Record<string, unknown>)["event"];
      if (typeof name === "string") names.push(name);
    }
  }
  const unique = [...new Set(names)];
  return {
    events_extracted_total: events.length,
    unique_event_names: unique.length,
    observed_event_names: unique,
  };
}

// ─── Runner ─────────────────────────────────────────────────────────────────

export async function runCase(
  testCase: SignalBackedCase,
  deps: RunCaseDeps,
  options: RunCaseOptions,
): Promise<RunResult> {
  const timestamp = new Date().toISOString();
  const gitCommit = await deps.getGitCommit();
  const accumulatedEvents = deps.getAccumulatedEvents();

  // Metrics counters
  let actionStepsTotal = 0;
  let toolCallsTotal = 0;

  // Set up agent for tool event tracking
  const agent = deps.createAgent();
  const unsubscribe = agent.subscribe((event: unknown) => {
    const e = event as Record<string, unknown>;
    if (e["type"] === "tool_execution_start") {
      toolCallsTotal++;
      const toolName = e["toolName"] as string;
      const args = (e["args"] ?? {}) as Record<string, unknown>;
      if (isActionStep(toolName, args)) {
        actionStepsTotal++;
      }
    }
  });

  const schemaUrl = options.schemaUrl ?? "https://tracking-docs-demo.buchert.digital/schemas/1.3.0/event-reference.json";
  const eventSchemas = await deps.discoverEventSchemas(schemaUrl, "web-datalayer-js");
  const { tools } = deps.buildAgentTools(accumulatedEvents, options.headless);

  await deps.openBrowser(testCase.entry_url, options.headless);

  let runError: Error | undefined;
  try {
    await deps.runInteractiveMode(
      schemaUrl,
      testCase.entry_url,
      eventSchemas,
      [],
      false,
      tools,
      accumulatedEvents,
      [],
      [],
      "",
      { info: () => {}, verbose: () => {}, warn: () => {}, error: () => {}, verbosity: "quiet" },
    );
  } catch (err) {
    runError = err instanceof Error ? err : new Error(String(err));
  } finally {
    unsubscribe();
    await deps.captureFinalEvents(accumulatedEvents);
    await deps.closeBrowser();
  }

  if (runError) throw runError;

  // Build metrics
  const { events_extracted_total, unique_event_names, observed_event_names } =
    extractEventMetrics(accumulatedEvents);

  const gradeInput = {
    events_extracted_total,
    unique_event_names,
    observed_event_names,
    action_steps_total: actionStepsTotal,
    no_progress_action_streak_max: 0, // not tracked yet
  };

  const gradeResult = gradeRun(testCase, gradeInput);
  const importantAnyOf = testCase.expected_signals.important_event_names_any_of ?? [];
  const observedSet = new Set(observed_event_names);
  const importantEventDetected =
    importantAnyOf.length === 0 || importantAnyOf.some((n) => observedSet.has(n));

  const result: RunResult = {
    $schema: "../schemas/run-result.schema.json",
    run_id: `${timestamp}-${testCase.case_id}`,
    timestamp,
    git_commit: gitCommit,
    case_id: testCase.case_id,
    site_id: testCase.site_id,
    family_id: testCase.family_id ?? null,
    lane: options.lane,
    outcome: {
      status: gradeResult.status,
      tracking_surface_found: events_extracted_total > 0,
      journey_completed: false,
      important_event_detected: importantEventDetected,
      human_intervention_needed: false,
      failure_class: gradeResult.reasons[0] ? "grader_failure" : null,
      failure_summary: gradeResult.reasons.length > 0 ? gradeResult.reasons.join("; ") : null,
    },
    metrics: {
      action_steps_total: actionStepsTotal,
      tool_calls_total: toolCallsTotal,
      events_extracted_total,
      unique_event_names,
    },
    human_comparison: options.humanBaseline
      ? {
          human_baseline_available: true,
          human_action_steps_total: options.humanBaseline.action_steps_total,
          step_ratio_vs_human:
            options.humanBaseline.action_steps_total > 0
              ? actionStepsTotal / options.humanBaseline.action_steps_total
              : 0,
          extra_steps_vs_human:
            actionStepsTotal - options.humanBaseline.action_steps_total,
        }
      : null,
  };

  const resultPath = buildResultPath(options.resultsDir, testCase.case_id, timestamp);
  await deps.writeResult(resultPath, result);

  return result;
}

// ─── Default production deps ─────────────────────────────────────────────────

export async function createProductionDeps(): Promise<RunCaseDeps> {
  // Eagerly import heavy modules once so all deps are synchronously available
  const [
    { openBrowser, closeRunBrowser, captureFinalEvents },
    { runInteractiveMode },
    { buildAgentTools, createAgent },
    { discoverEventSchemas },
  ] = await Promise.all([
    import("../workflows/runtime.js"),
    import("../workflows/agent-workflows.js"),
    import("../agent/runtime.js"),
    import("../schema.js"),
  ]);

  const accumulatedEvents: unknown[] = [];

  return {
    openBrowser: (url, headless) => openBrowser(url, headless),
    closeBrowser: () => closeRunBrowser(),
    captureFinalEvents: (events) => captureFinalEvents(events),
    runInteractiveMode: (
      schemaUrl, targetUrl, eventSchemas, savedMessages, resume,
      agentTools, accEvts, foundEventNames, skippedEvents,
      credentialsSummary, log,
    ) =>
      runInteractiveMode(
        schemaUrl, targetUrl,
        eventSchemas as Parameters<typeof runInteractiveMode>[2],
        savedMessages, resume,
        agentTools as Parameters<typeof runInteractiveMode>[5],
        accEvts, foundEventNames, skippedEvents,
        credentialsSummary,
        log as Parameters<typeof runInteractiveMode>[10],
      ),
    buildAgentTools: (evts, headless) => buildAgentTools(evts, headless),
    discoverEventSchemas: (schemaUrl, target) =>
      discoverEventSchemas(schemaUrl, target),
    createAgent: () => createAgent(),
    writeResult: defaultWriteResult,
    getGitCommit: defaultGetGitCommit,
    getAccumulatedEvents: () => accumulatedEvents,
  };
}
