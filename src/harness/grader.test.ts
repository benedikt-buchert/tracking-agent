import { describe, it, expect } from "vitest";
import { gradeRun } from "./grader.js";
import type { GradeInput } from "./grader.js";
import type { SignalBackedCase } from "./types.js";

function makeCase(overrides: Partial<SignalBackedCase> = {}): SignalBackedCase {
  return {
    $schema: "s",
    case_id: "test-01",
    site_id: "test",
    kind: "local",
    entry_url: "http://localhost:4321/",
    journey_hint: "hint",
    expected_signals: {
      tracking_surfaces: ["dataLayer"],
      min_events_total: 2,
      min_unique_event_names: 2,
      important_event_names_any_of: ["purchase"],
    },
    negative_signals: {
      forbidden_event_names: ["forbidden_event"],
    },
    budgets: {
      max_action_steps: 20,
      max_no_progress_actions: 6,
    },
    grader: { type: "heuristic", strictness: "medium" },
    ...overrides,
  };
}

function makeInput(overrides: Partial<GradeInput> = {}): GradeInput {
  return {
    events_extracted_total: 3,
    unique_event_names: 2,
    observed_event_names: ["page_view", "purchase"],
    action_steps_total: 10,
    no_progress_action_streak_max: 2,
    ...overrides,
  };
}

describe("gradeRun — passing cases", () => {
  it("passes when all conditions met", () => {
    const result = gradeRun(makeCase(), makeInput());
    expect(result.status).toBe("passed");
    expect(result.reasons).toHaveLength(0);
  });

  it("passes with no important_event_names_any_of requirement", () => {
    const c = makeCase({
      expected_signals: {
        tracking_surfaces: ["dataLayer"],
        min_events_total: 2,
        min_unique_event_names: 2,
        important_event_names_any_of: [],
      },
    });
    const result = gradeRun(c, makeInput());
    expect(result.status).toBe("passed");
  });
});

describe("gradeRun — tracking surface", () => {
  it("fails when no events extracted (tracking surface not found)", () => {
    const input = makeInput({ events_extracted_total: 0, unique_event_names: 0, observed_event_names: [] });
    const result = gradeRun(makeCase(), input);
    expect(result.status).toBe("failed");
    expect(result.reasons.some((r) => /tracking surface/i.test(r))).toBe(true);
  });
});

describe("gradeRun — min_events_total", () => {
  it("fails when below min_events_total", () => {
    const input = makeInput({ events_extracted_total: 1 });
    const result = gradeRun(makeCase(), input);
    expect(result.status).toBe("failed");
    expect(result.reasons.some((r) => /min_events_total/i.test(r))).toBe(true);
  });

  it("passes when exactly at min_events_total", () => {
    const input = makeInput({ events_extracted_total: 2 });
    const result = gradeRun(makeCase(), input);
    expect(result.status).toBe("passed");
  });
});

describe("gradeRun — min_unique_event_names", () => {
  it("fails when below min_unique_event_names", () => {
    const input = makeInput({ unique_event_names: 1 });
    const result = gradeRun(makeCase(), input);
    expect(result.status).toBe("failed");
    expect(result.reasons.some((r) => /min_unique_event_names/i.test(r))).toBe(true);
  });

  it("passes when exactly at min_unique_event_names", () => {
    const input = makeInput({ unique_event_names: 2 });
    const result = gradeRun(makeCase(), input);
    expect(result.status).toBe("passed");
  });
});

describe("gradeRun — important_event_names_any_of", () => {
  it("fails when important event not observed", () => {
    const input = makeInput({ observed_event_names: ["page_view", "add_to_cart"] });
    const result = gradeRun(makeCase(), input);
    expect(result.status).toBe("failed");
    expect(result.reasons.some((r) => /important_event/i.test(r))).toBe(true);
  });

  it("passes when at least one important event observed", () => {
    const input = makeInput({ observed_event_names: ["page_view", "purchase"] });
    const result = gradeRun(makeCase(), input);
    expect(result.status).toBe("passed");
  });
});

describe("gradeRun — forbidden events", () => {
  it("fails when a forbidden event was observed", () => {
    const input = makeInput({ observed_event_names: ["purchase", "forbidden_event"] });
    const result = gradeRun(makeCase(), input);
    expect(result.status).toBe("failed");
    expect(result.reasons.some((r) => /forbidden/i.test(r))).toBe(true);
  });
});

describe("gradeRun — budget", () => {
  it("fails when action_steps_total exceeds max_action_steps", () => {
    const input = makeInput({ action_steps_total: 21 });
    const result = gradeRun(makeCase(), input);
    expect(result.status).toBe("failed");
    expect(result.reasons.some((r) => /budget/i.test(r))).toBe(true);
  });

  it("passes when action_steps_total equals max_action_steps", () => {
    const input = makeInput({ action_steps_total: 20 });
    const result = gradeRun(makeCase(), input);
    expect(result.status).toBe("passed");
  });
});

describe("gradeRun — no-progress streak", () => {
  it("fails when no_progress_action_streak_max exceeds max_no_progress_actions", () => {
    const input = makeInput({ no_progress_action_streak_max: 7 });
    const result = gradeRun(makeCase(), input);
    expect(result.status).toBe("failed");
    expect(result.reasons.some((r) => /no.progress/i.test(r))).toBe(true);
  });

  it("passes when streak equals max_no_progress_actions", () => {
    const input = makeInput({ no_progress_action_streak_max: 6 });
    const result = gradeRun(makeCase(), input);
    expect(result.status).toBe("passed");
  });

  it("skips streak check if max_no_progress_actions not set", () => {
    const c = makeCase({ budgets: { max_action_steps: 20 } });
    const input = makeInput({ no_progress_action_streak_max: 999 });
    const result = gradeRun(c, input);
    // streak check is skipped, other things may still fail
    expect(result.reasons.every((r) => !/no.progress/i.test(r))).toBe(true);
  });
});

describe("gradeRun — multiple failures", () => {
  it("collects multiple failure reasons", () => {
    const input = makeInput({
      events_extracted_total: 0,
      unique_event_names: 0,
      observed_event_names: [],
      action_steps_total: 25,
      no_progress_action_streak_max: 10,
    });
    const result = gradeRun(makeCase(), input);
    expect(result.status).toBe("failed");
    expect(result.reasons.length).toBeGreaterThan(1);
  });
});
