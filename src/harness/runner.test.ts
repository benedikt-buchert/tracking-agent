import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunCaseDeps, RunCaseOptions } from "./runner.js";
import { runCase } from "./runner.js";
import type { SignalBackedCase } from "./types.js";

const testCase: SignalBackedCase = {
  $schema: "s",
  case_id: "test-01",
  site_id: "test-site",
  kind: "local",
  entry_url: "http://localhost:4321/",
  journey_hint: "Test journey",
  expected_signals: {
    tracking_surfaces: ["dataLayer"],
    min_events_total: 1,
    min_unique_event_names: 1,
    important_event_names_any_of: ["purchase"],
  },
  budgets: { max_action_steps: 20, max_no_progress_actions: 6 },
  grader: { type: "heuristic", strictness: "medium" },
};

function makeDeps(overrides: Partial<RunCaseDeps> = {}): RunCaseDeps {
  const accumulatedEvents: unknown[] = [];

  return {
    runStagehandCase: vi.fn().mockResolvedValue({
      accumulatedEvents: [{ event: "purchase" }],
      actionStepsTotal: 4,
      toolCallsTotal: 6,
      noProgressActionStreakMax: 1,
      journeyCompleted: true,
      humanInterventionNeeded: false,
    }),
    writeResult: vi.fn().mockResolvedValue(undefined),
    getGitCommit: vi.fn().mockResolvedValue("abc123"),
    getAccumulatedEvents: () => accumulatedEvents,
    ...overrides,
  };
}

function makeOptions(overrides: Partial<RunCaseOptions> = {}): RunCaseOptions {
  return {
    headless: true,
    lane: "discovery_known",
    resultsDir: "/tmp/harness-results",
    ...overrides,
  };
}

describe("runCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to the Stagehand case runner", async () => {
    const deps = makeDeps();

    await runCase(testCase, deps, makeOptions());

    expect(deps.runStagehandCase).toHaveBeenCalledWith(testCase, {
      headless: true,
      schemaUrl:
        "https://tracking-docs-demo.buchert.digital/schemas/1.3.0/event-reference.json",
    });
  });

  it("writes result with correct case metadata", async () => {
    const deps = makeDeps();
    await runCase(testCase, deps, makeOptions());

    const result = vi.mocked(deps.writeResult).mock.calls[0]?.[1];
    expect(result?.case_id).toBe("test-01");
    expect(result?.site_id).toBe("test-site");
    expect(result?.git_commit).toBe("abc123");
    expect(result?.lane).toBe("discovery_known");
  });

  it("records elapsed_ms and ms_per_action_step", async () => {
    const realNow = Date.now;
    vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(1_250);

    try {
      const deps = makeDeps();
      await runCase(testCase, deps, makeOptions());

      const result = vi.mocked(deps.writeResult).mock.calls[0]?.[1];
      expect(result?.metrics.elapsed_ms).toBe(250);
      expect(result?.metrics.ms_per_action_step).toBe(62.5);
    } finally {
      Date.now = realNow;
      vi.restoreAllMocks();
    }
  });

  it("records observed event names from the Stagehand run", async () => {
    const deps = makeDeps({
      runStagehandCase: vi.fn().mockResolvedValue({
        accumulatedEvents: [
          { event: "purchase" },
          { event: "page_view" },
          { event: "purchase" },
        ],
        actionStepsTotal: 4,
        toolCallsTotal: 6,
        noProgressActionStreakMax: 1,
        journeyCompleted: true,
        humanInterventionNeeded: false,
      }),
    });

    await runCase(testCase, deps, makeOptions());

    const result = vi.mocked(deps.writeResult).mock.calls[0]?.[1];
    expect(result?.metrics.events_extracted_total).toBe(3);
    expect(result?.metrics.unique_event_names).toBe(2);
    expect(result?.metrics.observed_event_names).toEqual([
      "purchase",
      "page_view",
    ]);
  });

  it("produces passed status when the important event is observed", async () => {
    const deps = makeDeps();
    await runCase(testCase, deps, makeOptions());

    const result = vi.mocked(deps.writeResult).mock.calls[0]?.[1];
    expect(result?.outcome.status).toBe("passed");
    expect(result?.outcome.important_event_detected).toBe(true);
    expect(result?.outcome.tracking_surface_found).toBe(true);
    expect(result?.outcome.journey_completed).toBe(true);
  });

  it("produces failed status when no events are extracted", async () => {
    const deps = makeDeps({
      runStagehandCase: vi.fn().mockResolvedValue({
        accumulatedEvents: [],
        actionStepsTotal: 4,
        toolCallsTotal: 6,
        noProgressActionStreakMax: 1,
        journeyCompleted: false,
        humanInterventionNeeded: false,
      }),
    });

    await runCase(testCase, deps, makeOptions());

    const result = vi.mocked(deps.writeResult).mock.calls[0]?.[1];
    expect(result?.outcome.status).toBe("failed");
    expect(result?.outcome.tracking_surface_found).toBe(false);
  });

  it("writes result path using resultsDir and case_id", async () => {
    const deps = makeDeps();
    await runCase(testCase, deps, makeOptions({ resultsDir: "/tmp/myresults" }));

    const writePath = vi.mocked(deps.writeResult).mock.calls[0]?.[0];
    expect(writePath).toMatch(/\/tmp\/myresults\//);
    expect(writePath).toMatch(/test-01/);
    expect(writePath).toMatch(/\.json$/);
  });

  it("includes human comparison when baseline provided", async () => {
    const deps = makeDeps();
    await runCase(
      testCase,
      deps,
      makeOptions({
        humanBaseline: {
          $schema: "s",
          human_baseline_id: "b1",
          case_id: "test-01",
          source: "manual",
          action_steps_total: 8,
        },
      }),
    );

    const result = vi.mocked(deps.writeResult).mock.calls[0]?.[1];
    expect(result?.human_comparison?.human_baseline_available).toBe(true);
    expect(result?.human_comparison?.human_action_steps_total).toBe(8);
  });
});
