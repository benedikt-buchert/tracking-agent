import { describe, it, expect } from "vitest";
import { loadCase, loadHumanBaseline, validateCase, validateHumanBaseline } from "./loader.js";
import type { SignalBackedCase, HumanBaseline } from "./types.js";

const validCase: SignalBackedCase = {
  $schema: "../schemas/signal-backed-case.schema.json",
  case_id: "test-case-01",
  site_id: "test-site",
  kind: "local",
  entry_url: "http://localhost:4321/",
  journey_hint: "Test journey",
  expected_signals: {
    tracking_surfaces: ["dataLayer"],
    min_events_total: 2,
    min_unique_event_names: 1,
    important_event_names_any_of: ["purchase"],
  },
  budgets: {
    max_action_steps: 20,
    max_tool_calls: 80,
    max_no_progress_actions: 6,
  },
  grader: { type: "heuristic", strictness: "medium" },
};

const validBaseline: HumanBaseline = {
  $schema: "../schemas/human-baseline.schema.json",
  human_baseline_id: "test-baseline-01",
  case_id: "test-case-01",
  source: "manual-recording",
  action_steps_total: 12,
  milestones: ["reached checkout", "observed purchase"],
};

describe("validateCase", () => {
  it("accepts a valid case", () => {
    const result = validateCase(validCase);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects a case missing required case_id", () => {
    const bad = { ...validCase, case_id: undefined } as unknown as SignalBackedCase;
    const result = validateCase(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects a case missing required entry_url", () => {
    const bad = { ...validCase, entry_url: undefined } as unknown as SignalBackedCase;
    const result = validateCase(bad);
    expect(result.valid).toBe(false);
  });

  it("rejects a case with invalid kind", () => {
    const bad = { ...validCase, kind: "unknown" } as unknown as SignalBackedCase;
    const result = validateCase(bad);
    expect(result.valid).toBe(false);
  });

  it("rejects a case with negative max_action_steps", () => {
    const bad = { ...validCase, budgets: { max_action_steps: 0 } };
    const result = validateCase(bad);
    expect(result.valid).toBe(false);
  });

  it("accepts case with optional fields omitted", () => {
    const minimal: SignalBackedCase = {
      $schema: "s",
      case_id: "c",
      site_id: "s",
      kind: "live",
      entry_url: "http://example.com/",
      journey_hint: "h",
      expected_signals: { tracking_surfaces: ["dataLayer"] },
      budgets: { max_action_steps: 10 },
      grader: { type: "heuristic" },
    };
    const result = validateCase(minimal);
    expect(result.valid).toBe(true);
  });
});

describe("validateHumanBaseline", () => {
  it("accepts a valid baseline", () => {
    const result = validateHumanBaseline(validBaseline);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects a baseline missing case_id", () => {
    const bad = { ...validBaseline, case_id: undefined } as unknown as HumanBaseline;
    const result = validateHumanBaseline(bad);
    expect(result.valid).toBe(false);
  });

  it("rejects a baseline with negative action_steps_total", () => {
    const bad = { ...validBaseline, action_steps_total: -1 };
    const result = validateHumanBaseline(bad);
    expect(result.valid).toBe(false);
  });
});

describe("loadCase", () => {
  it("loads and validates the example case file", async () => {
    const { resolve } = await import("path");
    const caseFile = resolve(
      import.meta.dirname,
      "..",
      "..",
      "harness",
      "cases",
      "local-discovery-01.json",
    );
    const loaded = await loadCase(caseFile);
    expect(loaded.case_id).toBe("local-discovery-01");
    expect(loaded.kind).toBe("local");
    expect(loaded.expected_signals.tracking_surfaces).toContain("dataLayer");
  });

  it("throws if file does not exist", async () => {
    await expect(loadCase("/nonexistent/path.json")).rejects.toThrow();
  });

  it("throws if file contains invalid JSON", async () => {
    const { writeFile, unlink } = await import("fs/promises");
    const tmp = "/tmp/harness-bad-case.json";
    await writeFile(tmp, "not json");
    await expect(loadCase(tmp)).rejects.toThrow();
    await unlink(tmp);
  });

  it("throws if case fails validation", async () => {
    const { writeFile, unlink } = await import("fs/promises");
    const tmp = "/tmp/harness-invalid-case.json";
    await writeFile(tmp, JSON.stringify({ case_id: "x" }));
    await expect(loadCase(tmp)).rejects.toThrow(/validation/i);
    await unlink(tmp);
  });
});

describe("loadHumanBaseline", () => {
  it("loads and validates a baseline from disk", async () => {
    const { writeFile, unlink } = await import("fs/promises");
    const tmp = "/tmp/harness-test-baseline.json";
    await writeFile(tmp, JSON.stringify(validBaseline));
    const loaded = await loadHumanBaseline(tmp);
    expect(loaded.human_baseline_id).toBe("test-baseline-01");
    await unlink(tmp);
  });

  it("throws if baseline fails validation", async () => {
    const { writeFile, unlink } = await import("fs/promises");
    const tmp = "/tmp/harness-bad-baseline.json";
    await writeFile(tmp, JSON.stringify({ human_baseline_id: "x" }));
    await expect(loadHumanBaseline(tmp)).rejects.toThrow(/validation/i);
    await unlink(tmp);
  });
});
