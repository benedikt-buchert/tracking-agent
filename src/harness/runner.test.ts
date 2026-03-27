import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RunCaseDeps, RunCaseOptions } from "./runner.js";
import { runCase } from "./runner.js";
import type { SignalBackedCase } from "./types.js";

// ─── Minimal valid case ───────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<RunCaseDeps> = {}): RunCaseDeps {
  const accumulatedEvents: unknown[] = [];

  return {
    openBrowser: vi.fn().mockResolvedValue(undefined),
    closeBrowser: vi.fn().mockResolvedValue(undefined),
    captureFinalEvents: vi.fn().mockImplementation(async (events: unknown[]) => {
      events.push({ event: "purchase" });
      return events;
    }),
    runInteractiveMode: vi.fn().mockResolvedValue(undefined),
    buildAgentTools: vi.fn().mockReturnValue({
      tools: [],
      browserFn: vi.fn(),
      sessionId: "test-session",
    }),
    discoverEventSchemas: vi.fn().mockResolvedValue([]),
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls openBrowser, runInteractiveMode, captureFinalEvents, closeBrowser in order", async () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      openBrowser: vi.fn().mockImplementation(async () => { callOrder.push("open"); }),
      runInteractiveMode: vi.fn().mockImplementation(async () => { callOrder.push("run"); }),
      captureFinalEvents: vi.fn().mockImplementation(async (events: unknown[]) => {
        callOrder.push("capture");
        events.push({ event: "purchase" });
        return events;
      }),
      closeBrowser: vi.fn().mockImplementation(async () => { callOrder.push("close"); }),
    });

    await runCase(testCase, deps, makeOptions());
    expect(callOrder).toEqual(["open", "run", "capture", "close"]);
  });

  it("writes result with correct case_id and site_id", async () => {
    const deps = makeDeps();
    await runCase(testCase, deps, makeOptions());

    const writeCall = vi.mocked(deps.writeResult).mock.calls[0];
    expect(writeCall).toBeDefined();
    const result = writeCall![1];
    expect(result.case_id).toBe("test-01");
    expect(result.site_id).toBe("test-site");
  });

  it("writes result with correct git_commit", async () => {
    const deps = makeDeps({
      getGitCommit: vi.fn().mockResolvedValue("deadbeef"),
    });
    await runCase(testCase, deps, makeOptions());

    const result = vi.mocked(deps.writeResult).mock.calls[0]![1];
    expect(result.git_commit).toBe("deadbeef");
  });

  it("writes result with correct lane", async () => {
    const deps = makeDeps();
    await runCase(testCase, deps, makeOptions({ lane: "discovery_live_target" }));

    const result = vi.mocked(deps.writeResult).mock.calls[0]![1];
    expect(result.lane).toBe("discovery_live_target");
  });

  it("counts action steps via wrapped tool execute calls", async () => {
    const navigateTool = { name: "browser_navigate", execute: vi.fn().mockResolvedValue("ok") };
    const snapshotTool = { name: "browser_snapshot", execute: vi.fn().mockResolvedValue("ok") };
    const clickTool = { name: "browser_click", execute: vi.fn().mockResolvedValue("ok") };

    const deps = makeDeps({
      buildAgentTools: vi.fn().mockReturnValue({
        tools: [navigateTool, snapshotTool, clickTool],
        browserFn: vi.fn(),
        sessionId: "s",
      }),
      runInteractiveMode: vi.fn().mockImplementation(async (_su, _tu, _es, _sm, _r, tools: unknown) => {
        const ts = tools as typeof navigateTool[];
        await ts.find(t => t.name === "browser_navigate")?.execute("s", {});
        await ts.find(t => t.name === "browser_snapshot")?.execute("s", {});
        await ts.find(t => t.name === "browser_click")?.execute("s", {});
      }),
    });

    await runCase(testCase, deps, makeOptions());

    const result = vi.mocked(deps.writeResult).mock.calls[0]![1];
    // navigate(1) + click(1) = 2; snapshot not counted
    expect(result.metrics.action_steps_total).toBe(2);
  });

  it("counts total tool calls via wrapped tools", async () => {
    const navigateTool = { name: "browser_navigate", execute: vi.fn().mockResolvedValue("ok") };
    const snapshotTool = { name: "browser_snapshot", execute: vi.fn().mockResolvedValue("ok") };
    const waitTool = { name: "browser_wait", execute: vi.fn().mockResolvedValue("ok") };

    const deps = makeDeps({
      buildAgentTools: vi.fn().mockReturnValue({
        tools: [navigateTool, snapshotTool, waitTool],
        browserFn: vi.fn(),
        sessionId: "s",
      }),
      runInteractiveMode: vi.fn().mockImplementation(async (_su, _tu, _es, _sm, _r, tools: unknown) => {
        const ts = tools as typeof navigateTool[];
        for (const t of ts) await t.execute("s", {});
      }),
    });

    await runCase(testCase, deps, makeOptions());

    const result = vi.mocked(deps.writeResult).mock.calls[0]![1];
    expect(result.metrics.tool_calls_total).toBe(3);
  });

  it("writes result with events_extracted_total from accumulated events", async () => {
    const events: unknown[] = [];
    const deps = makeDeps({
      getAccumulatedEvents: () => events,
      captureFinalEvents: vi.fn().mockImplementation(async (evts: unknown[]) => {
        evts.push({ event: "purchase" });
        evts.push({ event: "page_view" });
        evts.push({ event: "purchase" });
        return evts;
      }),
    });

    await runCase(testCase, deps, makeOptions());

    const result = vi.mocked(deps.writeResult).mock.calls[0]![1];
    expect(result.metrics.events_extracted_total).toBe(3);
    expect(result.metrics.unique_event_names).toBe(2);
  });

  it("produces passed status when important event observed", async () => {
    const deps = makeDeps();
    await runCase(testCase, deps, makeOptions());

    const result = vi.mocked(deps.writeResult).mock.calls[0]![1];
    expect(result.outcome.status).toBe("passed");
    expect(result.outcome.important_event_detected).toBe(true);
    expect(result.outcome.tracking_surface_found).toBe(true);
  });

  it("produces failed status when no events extracted", async () => {
    const deps = makeDeps({
      captureFinalEvents: vi.fn().mockImplementation(async (events: unknown[]) => events),
    });

    await runCase(testCase, deps, makeOptions());

    const result = vi.mocked(deps.writeResult).mock.calls[0]![1];
    expect(result.outcome.status).toBe("failed");
    expect(result.outcome.tracking_surface_found).toBe(false);
  });

  it("closes browser even when runInteractiveMode throws", async () => {
    const deps = makeDeps({
      runInteractiveMode: vi.fn().mockRejectedValue(new Error("agent crashed")),
    });

    await expect(runCase(testCase, deps, makeOptions())).rejects.toThrow("agent crashed");
    expect(deps.closeBrowser).toHaveBeenCalledOnce();
  });

  it("writes result path using resultsDir and case_id", async () => {
    const deps = makeDeps();
    await runCase(testCase, deps, makeOptions({ resultsDir: "/tmp/myresults" }));

    const writePath = vi.mocked(deps.writeResult).mock.calls[0]![0];
    expect(writePath).toMatch(/\/tmp\/myresults\//);
    expect(writePath).toMatch(/test-01/);
    expect(writePath).toMatch(/\.json$/);
  });

  it("includes human comparison when baseline provided", async () => {
    const deps = makeDeps();
    await runCase(testCase, deps, makeOptions({
      humanBaseline: {
        $schema: "s",
        human_baseline_id: "b1",
        case_id: "test-01",
        source: "manual",
        action_steps_total: 8,
      },
    }));

    const result = vi.mocked(deps.writeResult).mock.calls[0]![1];
    expect(result.human_comparison?.human_baseline_available).toBe(true);
    expect(result.human_comparison?.human_action_steps_total).toBe(8);
  });

  it("omits human comparison when no baseline provided", async () => {
    const deps = makeDeps();
    await runCase(testCase, deps, makeOptions());

    const result = vi.mocked(deps.writeResult).mock.calls[0]![1];
    expect(result.human_comparison).toBeNull();
  });
});
