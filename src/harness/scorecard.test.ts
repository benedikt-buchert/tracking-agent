import { describe, it, expect } from "vitest";
import { buildScorecard, formatScorecard } from "./scorecard.js";
import type { RunResult } from "./types.js";

function makeResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    $schema: "s",
    run_id: "2026-01-01T00:00:00.000Z-test-01",
    timestamp: "2026-01-01T00:00:00.000Z",
    git_commit: "abc1234",
    case_id: "test-01",
    site_id: "test-site",
    family_id: null,
    lane: "discovery_known",
    outcome: {
      status: "passed",
      tracking_surface_found: true,
      journey_completed: false,
      important_event_detected: true,
      human_intervention_needed: false,
      failure_class: null,
      failure_summary: null,
    },
    metrics: {
      action_steps_total: 10,
      tool_calls_total: 30,
      events_extracted_total: 4,
      unique_event_names: 3,
    },
    human_comparison: null,
    ...overrides,
  };
}

describe("buildScorecard", () => {
  it("returns empty rows for empty results", () => {
    const sc = buildScorecard([]);
    expect(sc.rows).toHaveLength(0);
    expect(sc.total).toBe(0);
    expect(sc.passed).toBe(0);
    expect(sc.failed).toBe(0);
  });

  it("counts passed and failed correctly", () => {
    const results = [
      makeResult({ case_id: "a", outcome: { status: "passed" } }),
      makeResult({ case_id: "b", outcome: { status: "failed" } }),
      makeResult({ case_id: "c", outcome: { status: "passed" } }),
    ];
    const sc = buildScorecard(results);
    expect(sc.total).toBe(3);
    expect(sc.passed).toBe(2);
    expect(sc.failed).toBe(1);
  });

  it("builds one row per result", () => {
    const results = [
      makeResult({ case_id: "a" }),
      makeResult({ case_id: "b" }),
    ];
    const sc = buildScorecard(results);
    expect(sc.rows).toHaveLength(2);
    expect(sc.rows[0]!.case_id).toBe("a");
    expect(sc.rows[1]!.case_id).toBe("b");
  });

  it("includes metrics in each row", () => {
    const result = makeResult({
      metrics: {
        action_steps_total: 15,
        tool_calls_total: 50,
        events_extracted_total: 6,
        unique_event_names: 4,
      },
    });
    const sc = buildScorecard([result]);
    expect(sc.rows[0]!.action_steps_total).toBe(15);
    expect(sc.rows[0]!.events_extracted_total).toBe(6);
    expect(sc.rows[0]!.unique_event_names).toBe(4);
  });

  it("includes status in each row", () => {
    const passed = makeResult({ outcome: { status: "passed" } });
    const failed = makeResult({ outcome: { status: "failed", failure_summary: "no events" } });
    const sc = buildScorecard([passed, failed]);
    expect(sc.rows[0]!.status).toBe("passed");
    expect(sc.rows[1]!.status).toBe("failed");
  });

  it("includes git_commit in scorecard", () => {
    const result = makeResult({ git_commit: "deadbeef" });
    const sc = buildScorecard([result]);
    expect(sc.git_commit).toBe("deadbeef");
  });
});

describe("formatScorecard", () => {
  it("returns a non-empty string for non-empty results", () => {
    const results = [makeResult()];
    const sc = buildScorecard(results);
    const text = formatScorecard(sc);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  it("includes case_id in output", () => {
    const results = [makeResult({ case_id: "my-unique-case" })];
    const sc = buildScorecard(results);
    const text = formatScorecard(sc);
    expect(text).toContain("my-unique-case");
  });

  it("includes pass/fail summary in output", () => {
    const results = [
      makeResult({ outcome: { status: "passed" } }),
      makeResult({ outcome: { status: "failed" } }),
    ];
    const sc = buildScorecard(results);
    const text = formatScorecard(sc);
    expect(text).toMatch(/1.*passed|passed.*1/i);
    expect(text).toMatch(/1.*failed|failed.*1/i);
  });

  it("includes action steps in output", () => {
    const results = [makeResult({ metrics: { action_steps_total: 7, tool_calls_total: 20, events_extracted_total: 3, unique_event_names: 2 } })];
    const sc = buildScorecard(results);
    const text = formatScorecard(sc);
    expect(text).toContain("7");
  });

  it("handles empty results gracefully", () => {
    const sc = buildScorecard([]);
    const text = formatScorecard(sc);
    expect(typeof text).toBe("string");
  });
});
