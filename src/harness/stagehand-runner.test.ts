import { describe, expect, it, vi } from "vitest";
import type { SignalBackedCase } from "./types.js";
import { runStagehandCase } from "./stagehand-runner.js";

const purchaseCase: SignalBackedCase = {
  $schema: "s",
  case_id: "stage-purchase",
  site_id: "shop",
  kind: "live",
  entry_url: "https://example.com",
  journey_hint:
    "Browse to a product, add it to cart, use guest checkout, and reach purchase.",
  expected_signals: {
    tracking_surfaces: ["dataLayer"],
    important_event_names_any_of: ["purchase"],
  },
  budgets: { max_action_steps: 20 },
  grader: { type: "heuristic", strictness: "high" },
};

const discoveryCase: SignalBackedCase = {
  ...purchaseCase,
  case_id: "discovery",
  journey_hint: "Reach the important tracked interaction on the site.",
  expected_signals: {
    tracking_surfaces: ["dataLayer"],
    important_event_names_any_of: ["sign_up"],
  },
};

function makeAgent(
  overrides: Partial<{
    execute: ReturnType<typeof vi.fn>;
    evaluate: ReturnType<typeof vi.fn>;
    drainCapturedEvents: ReturnType<typeof vi.fn>;
    getCaptureDiagnostics: ReturnType<typeof vi.fn>;
    waitForTimeout: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return {
    execute: overrides.execute ?? vi.fn().mockResolvedValue({ actions: [] }),
    evaluate:
      overrides.evaluate ?? vi.fn().mockResolvedValue({ repaired: true }),
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
  it("runs Stagehand agent phases and stops once the important event is observed", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        completed: false,
        actions: [{}, {}, {}],
      })
      .mockResolvedValueOnce({
        completed: true,
        actions: [{}, {}],
      });
    const drainCapturedEvents = vi
      .fn()
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ event: "add_to_cart" }])
      .mockReturnValueOnce([{ event: "purchase" }]);
    const agent = makeAgent({ execute, drainCapturedEvents });

    const result = await runStagehandCase(purchaseCase, {
      headless: true,
      createAgent: vi.fn().mockResolvedValue(agent),
      variables: {
        email: {
          value: "buyer@example.com",
          description: "Buyer email",
        },
      },
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        instruction: expect.stringContaining("guest checkout"),
        maxSteps: 20,
        variables: {
          email: {
            value: "buyer@example.com",
            description: "Buyer email",
          },
        },
      }),
    );
    expect(execute.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        instruction: expect.stringContaining("ACCEPT ADDRESS"),
        maxSteps: 20,
      }),
    );
    expect(result.accumulatedEvents).toEqual([
      { event: "add_to_cart" },
      { event: "purchase" },
    ]);
    expect(result.actionStepsTotal).toBe(5);
    expect(result.toolCallsTotal).toBe(6);
    expect(result.journeyCompleted).toBe(true);
    expect(result.captureDiagnostics).toEqual({
      capturedEvents: [],
      rawDataLayerEvents: [],
    });
    expect(agent.close).toHaveBeenCalledOnce();
  });

  it("skips checkout-repair phases for non-purchase journeys", async () => {
    const execute = vi.fn().mockResolvedValue({
      completed: true,
      actions: [{}, {}],
    });
    const drainCapturedEvents = vi
      .fn()
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ event: "sign_up" }]);
    const agent = makeAgent({ execute, drainCapturedEvents });

    const result = await runStagehandCase(discoveryCase, {
      headless: true,
      createAgent: vi.fn().mockResolvedValue(agent),
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        instruction: expect.not.stringContaining("guest checkout"),
      }),
    );
    expect(result.accumulatedEvents).toEqual([{ event: "sign_up" }]);
    expect(result.actionStepsTotal).toBe(2);
    expect(result.toolCallsTotal).toBe(3);
  });

  it("includes deterministic repair before the second checkout phase", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ completed: false, actions: [{}] })
      .mockResolvedValueOnce({ completed: false, actions: [{}] })
      .mockResolvedValueOnce({ completed: false, actions: [{}] });
    const evaluate = vi.fn().mockResolvedValue({ repaired: true });
    const drainCapturedEvents = vi
      .fn()
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);
    const agent = makeAgent({ execute, evaluate, drainCapturedEvents });

    await runStagehandCase(purchaseCase, {
      headless: true,
      createAgent: vi.fn().mockResolvedValue(agent),
    });

    expect(evaluate.mock.calls[0]?.[0]).toContain("Kaufingerstrasse");
    expect(execute.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        instruction: expect.stringContaining(
          "Do not rewrite the delivery fields",
        ),
      }),
    );
    expect(execute.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({
        instruction: expect.stringContaining("credit-card payment flow"),
      }),
    );
  });

  it("returns partial results when a phase times out", async () => {
    vi.useFakeTimers();
    const execute = vi.fn().mockImplementation(() => new Promise(() => {}));
    const drainCapturedEvents = vi
      .fn()
      .mockReturnValueOnce([{ event: "pageview" }])
      .mockReturnValueOnce([{ event: "view_item" }]);
    const close = vi.fn().mockResolvedValue(undefined);
    const agent = makeAgent({ execute, drainCapturedEvents, close });

    const runPromise = runStagehandCase(discoveryCase, {
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
      .mockReturnValueOnce([{ event: "add_to_cart" }, { event: "purchase" }]);
    const close = vi.fn().mockResolvedValue(undefined);
    const agent = makeAgent({ execute, drainCapturedEvents, close });

    const runPromise = runStagehandCase(purchaseCase, {
      headless: true,
      createAgent: vi.fn().mockResolvedValue(agent),
      phaseTimeoutMs: 1,
      onInterventionNeeded,
    });

    await vi.advanceTimersByTimeAsync(1);
    const result = await runPromise;

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: expect.any(String),
        maxSteps: 20,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(onInterventionNeeded).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "phase1",
        accumulatedEvents: [{ event: "pageview" }, { event: "view_item" }],
      }),
    );
    expect(result.accumulatedEvents).toEqual([
      { event: "pageview" },
      { event: "view_item" },
      { event: "add_to_cart" },
      { event: "purchase" },
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

    const runPromise = runStagehandCase(discoveryCase, {
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
