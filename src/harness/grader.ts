import type { SignalBackedCase } from "./types.js";

export interface GradeInput {
  events_extracted_total: number;
  unique_event_names: number;
  observed_event_names: string[];
  action_steps_total: number;
  no_progress_action_streak_max: number;
}

export interface GradeResult {
  status: "passed" | "failed";
  reasons: string[];
}

/**
 * Heuristic grader for a SignalBackedCase.
 *
 * Passes when:
 * - tracking surface was found (at least one event extracted)
 * - events_extracted_total >= expected_signals.min_events_total (if set)
 * - unique_event_names >= expected_signals.min_unique_event_names (if set)
 * - at least one of important_event_names_any_of was observed (if non-empty)
 * - no forbidden events observed
 * - action steps within budget
 * - no excessive no-progress streak
 */
export function gradeRun(
  testCase: SignalBackedCase,
  input: GradeInput,
): GradeResult {
  const reasons: string[] = [];
  const { expected_signals, negative_signals, budgets } = testCase;

  // 1. Tracking surface found
  if (input.events_extracted_total === 0) {
    reasons.push("tracking surface not found: no events extracted");
  }

  // 2. min_events_total
  const minEventsTotal = expected_signals.min_events_total ?? 0;
  if (minEventsTotal > 0 && input.events_extracted_total < minEventsTotal) {
    reasons.push(
      `min_events_total not met: expected at least ${minEventsTotal}, got ${input.events_extracted_total}`,
    );
  }

  // 3. min_unique_event_names
  const minUniqueNames = expected_signals.min_unique_event_names ?? 0;
  if (minUniqueNames > 0 && input.unique_event_names < minUniqueNames) {
    reasons.push(
      `min_unique_event_names not met: expected at least ${minUniqueNames}, got ${input.unique_event_names}`,
    );
  }

  // 4. important_event_names_any_of
  const importantAnyOf = expected_signals.important_event_names_any_of ?? [];
  if (importantAnyOf.length > 0) {
    const observedSet = new Set(input.observed_event_names);
    const anyFound = importantAnyOf.some((name) => observedSet.has(name));
    if (!anyFound) {
      reasons.push(
        `important_event not detected: none of [${importantAnyOf.join(", ")}] were observed`,
      );
    }
  }

  // 5. Forbidden events
  const forbiddenNames = negative_signals?.forbidden_event_names ?? [];
  if (forbiddenNames.length > 0) {
    const observedSet = new Set(input.observed_event_names);
    const found = forbiddenNames.filter((name) => observedSet.has(name));
    if (found.length > 0) {
      reasons.push(
        `forbidden events observed: [${found.join(", ")}]`,
      );
    }
  }

  // 6. Action step budget
  if (input.action_steps_total > budgets.max_action_steps) {
    reasons.push(
      `action step budget exceeded: used ${input.action_steps_total}, max ${budgets.max_action_steps}`,
    );
  }

  // 7. No-progress streak
  const maxNoProgress = budgets.max_no_progress_actions;
  if (maxNoProgress !== undefined && input.no_progress_action_streak_max > maxNoProgress) {
    reasons.push(
      `no-progress streak exceeded: max streak ${input.no_progress_action_streak_max}, limit ${maxNoProgress}`,
    );
  }

  return {
    status: reasons.length === 0 ? "passed" : "failed",
    reasons,
  };
}
