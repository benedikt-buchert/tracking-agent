import { describe, expect, it, vi } from "vitest";
import type { SignalBackedCase } from "./types.js";
import { runStagehandCase } from "./stagehand-runner.js";

const testCase: SignalBackedCase = {
  $schema: "s",
  case_id: "test",
  site_id: "site",
  kind: "live",
  entry_url: "https://example.com",
  journey_hint: "Reach the important tracked interaction on the site.",
  expected_signals: {
    tracking_surfaces: ["dataLayer"],
    important_event_names_any_of: ["sign_up"],
  },
  budgets: { max_action_steps: 20 },
  grader: { type: "heuristic", strictness: "medium" },
};

function makeAgent(
  overrides: Partial<{
    execute: ReturnType<typeof vi.fn>;
    drainCapturedEvents: ReturnType<typeof vi.fn>;
    getCaptureDiagnostics: ReturnType<typeof vi.fn>;
    waitForTimeout: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return {
    execute: overrides.execute ?? vi.fn().mockResolvedValue({ actions: [] }),
    drainCapturedEvents:
      overrides.drainCapturedEvents ?? vi.fn().mockReturnValue([]),
    getCaptureDiagnostics:
      overrides.getCaptureDiagnostics ??
      vi.fn().mockResolvedValue({
        capturedEvents: [],
        rawDataLayerEvents: [],
      }),
    waitForTimeout:
      overrides.waitForTimeout ?? vi.fn().mockResolvedValue(undefined),
    close: overrides.close ?? vi.fn().mockResolvedValue(undefined),
  };
}

describe("runStagehandCase", () => {
  it("runs the agent and returns accumulated events and metrics", async () => {
    const execute = vi.fn().mockResolvedValue({
      completed: true,
      actions: [{}, {}],
    });
    const drainCapturedEvents = vi
      .fn()
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ event: "sign_up" }]);
    const agent = makeAgent({ execute, drainCapturedEvents });

    const result = await runStagehandCase(testCase, {
      headless: true,
      createAgent: vi.fn().mockResolvedValue(agent),
      variables: { email: { value: "user@example.com", description: "Email" } },
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        instruction: expect.stringContaining("sign_up"),
        maxSteps: 20,
        variables: { email: { value: "user@example.com", description: "Email" } },
      }),
    );
    expect(result.accumulatedEvents).toEqual([{ event: "sign_up" }]);
    expect(result.actionStepsTotal).toBe(2);
    expect(result.toolCallsTotal).toBe(2);
    expect(result.journeyCompleted).toBe(true);
    expect(result.captureDiagnostics).toEqual({
      capturedEvents: [],
      rawDataLayerEvents: [],
    });
    expect(agent.close).toHaveBeenCalledOnce();
  });

  it("marks journeyCompleted when an important event is observed even if agent did not signal completion", async () => {
    const execute = vi.fn().mockResolvedValue({
      completed: false,
      actions: [{}],
    });
    const drainCapturedEvents = vi
      .fn()
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ event: "sign_up" }]);
    const agent = makeAgent({ execute, drainCapturedEvents });

    const result = await runStagehandCase(testCase, {
      headless: true,
      createAgent: vi.fn().mockResolvedValue(agent),
    });

    expect(result.journeyCompleted).toBe(true);
  });

  it("returns partial results when the run times out", async () => {
    vi.useFakeTimers();
    const execute = vi.fn().mockImplementation(() => new Promise(() => {}));
    const drainCapturedEvents = vi
      .fn()
      .mockReturnValueOnce([{ event: "pageview" }])
      .mockReturnValueOnce([{ event: "view_item" }]);
    const close = vi.fn().mockResolvedValue(undefined);
    const agent = makeAgent({ execute, drainCapturedEvents, close });

    const runPromise = runStagehandCase(testCase, {
      headless: true,
      createAgent: vi.fn().mockResolvedValue(agent),
      phaseTimeoutMs: 1,
    });

    await vi.advanceTimersByTimeAsync(1);
    const result = await runPromise;

    expect(result.accumulatedEvents).toEqual([
      { event: "pageview" },
      { event: "view_item" },
    ]);
    expect(result.actionStepsTotal).toBe(0);
    expect(result.toolCallsTotal).toBe(2);
    expect(result.journeyCompleted).toBe(false);
    expect(result.humanInterventionNeeded).toBe(true);
    expect(close).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });

  it("lets the user intervene after a timeout and captures post-handoff events", async () => {
    vi.useFakeTimers();
    const execute = vi.fn().mockImplementation(() => new Promise(() => {}));
    const onInterventionNeeded = vi.fn().mockResolvedValue("continue");
    const drainCapturedEvents = vi
      .fn()
      .mockReturnValueOnce([{ event: "pageview" }])
      .mockReturnValueOnce([{ event: "view_item" }])
      .mockReturnValueOnce([{ event: "sign_up" }]);
    const close = vi.fn().mockResolvedValue(undefined);
    const agent = makeAgent({ execute, drainCapturedEvents, close });

    const runPromise = runStagehandCase(testCase, {
      headless: true,
      createAgent: vi.fn().mockResolvedValue(agent),
      phaseTimeoutMs: 1,
      onInterventionNeeded,
    });

    await vi.advanceTimersByTimeAsync(1);
    const result = await runPromise;

    expect(onInterventionNeeded).toHaveBeenCalledWith(
      expect.objectContaining({
        accumulatedEvents: [{ event: "pageview" }, { event: "view_item" }],
      }),
    );
    expect(result.accumulatedEvents).toEqual([
      { event: "pageview" },
      { event: "view_item" },
      { event: "sign_up" },
    ]);
    expect(result.journeyCompleted).toBe(true);
    expect(result.humanInterventionNeeded).toBe(false);
    expect(close).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });

  it("does not hang if capture diagnostics never resolve during finalization", async () => {
    vi.useFakeTimers();
    const execute = vi.fn().mockImplementation(() => new Promise(() => {}));
    const onInterventionNeeded = vi.fn().mockResolvedValue("stop");
    const drainCapturedEvents = vi
      .fn()
      .mockReturnValueOnce([{ event: "pageview" }])
      .mockReturnValueOnce([{ event: "view_item" }]);
    const getCaptureDiagnostics = vi
      .fn()
      .mockImplementation(() => new Promise(() => {}));
    const close = vi.fn().mockResolvedValue(undefined);
    const agent = makeAgent({
      execute,
      drainCapturedEvents,
      getCaptureDiagnostics,
      close,
    });

    const runPromise = runStagehandCase(testCase, {
      headless: true,
      createAgent: vi.fn().mockResolvedValue(agent),
      phaseTimeoutMs: 1,
      onInterventionNeeded,
    });

    await vi.advanceTimersByTimeAsync(5_001);
    const result = await runPromise;

    expect(result.accumulatedEvents).toEqual([
      { event: "pageview" },
      { event: "view_item" },
    ]);
    expect(result.captureDiagnostics).toBeUndefined();
    expect(close).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });
});
