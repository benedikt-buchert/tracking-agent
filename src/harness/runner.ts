import { join } from "path";
import type {
  SignalBackedCase,
  HumanBaseline,
  RunResult,
  RunLane,
} from "./types.js";
import { gradeRun } from "./grader.js";

export interface RunCaseDeps {
  runStagehandCase: (
    testCase: SignalBackedCase,
    options: Pick<RunCaseOptions, "headless" | "schemaUrl">,
  ) => Promise<{
    accumulatedEvents: unknown[];
    actionStepsTotal: number;
    toolCallsTotal: number;
    noProgressActionStreakMax?: number;
    journeyCompleted?: boolean;
    humanInterventionNeeded?: boolean;
  }>;
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

function buildResultPath(
  resultsDir: string,
  caseId: string,
  timestamp: string,
): string {
  const safe = timestamp.replace(/[:.]/g, "-");
  return join(resultsDir, `${safe}-${caseId}.json`);
}

function extractEventMetrics(events: unknown[]): {
  events_extracted_total: number;
  unique_event_names: number;
  observed_event_names: string[];
} {
  const names: string[] = [];
  for (const event of events) {
    if (event && typeof event === "object") {
      const name = (event as Record<string, unknown>)["event"];
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
export async function runCase(
  testCase: SignalBackedCase,
  deps: RunCaseDeps,
  options: RunCaseOptions,
): Promise<RunResult> {
  const startedAt = Date.now();
  const timestamp = new Date().toISOString();
  const gitCommit = await deps.getGitCommit();
  const accumulatedEvents = deps.getAccumulatedEvents();
  const schemaUrl =
    options.schemaUrl ??
    "https://tracking-docs-demo.buchert.digital/schemas/1.3.0/event-reference.json";

  const stagehandResult = await deps.runStagehandCase(testCase, {
    headless: options.headless,
    schemaUrl,
  });
  accumulatedEvents.push(...stagehandResult.accumulatedEvents);

  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const { events_extracted_total, unique_event_names, observed_event_names } =
    extractEventMetrics(accumulatedEvents);

  const gradeResult = gradeRun(testCase, {
    events_extracted_total,
    unique_event_names,
    observed_event_names,
    action_steps_total: stagehandResult.actionStepsTotal,
    no_progress_action_streak_max:
      stagehandResult.noProgressActionStreakMax ?? 0,
  });

  const importantAnyOf =
    testCase.expected_signals.important_event_names_any_of ?? [];
  const observedSet = new Set(observed_event_names);
  const importantEventDetected =
    importantAnyOf.length === 0 ||
    importantAnyOf.some((name) => observedSet.has(name));

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
      journey_completed: stagehandResult.journeyCompleted ?? false,
      important_event_detected: importantEventDetected,
      human_intervention_needed:
        stagehandResult.humanInterventionNeeded ?? false,
      failure_class: gradeResult.reasons[0] ? "grader_failure" : null,
      failure_summary:
        gradeResult.reasons.length > 0 ? gradeResult.reasons.join("; ") : null,
    },
    metrics: {
      action_steps_total: stagehandResult.actionStepsTotal,
      tool_calls_total: stagehandResult.toolCallsTotal,
      elapsed_ms: elapsedMs,
      ms_per_action_step:
        stagehandResult.actionStepsTotal > 0
          ? elapsedMs / stagehandResult.actionStepsTotal
          : undefined,
      events_extracted_total,
      unique_event_names,
      observed_event_names,
      no_progress_action_streak_max: stagehandResult.noProgressActionStreakMax,
    },
    human_comparison: options.humanBaseline
      ? {
          human_baseline_available: true,
          human_action_steps_total: options.humanBaseline.action_steps_total,
          step_ratio_vs_human:
            options.humanBaseline.action_steps_total > 0
              ? stagehandResult.actionStepsTotal /
                options.humanBaseline.action_steps_total
              : 0,
          extra_steps_vs_human:
            stagehandResult.actionStepsTotal -
            options.humanBaseline.action_steps_total,
        }
      : null,
  };

  const resultPath = buildResultPath(
    options.resultsDir,
    testCase.case_id,
    timestamp,
  );
  await deps.writeResult(resultPath, result);
  return result;
}
