// ─── Signal-Backed Case ───────────────────────────────────────────────────────

export interface ExpectedSignals {
  tracking_surfaces: string[];
  event_names_any_of?: string[];
  event_name_prefixes_any_of?: string[];
  event_property_keys_any_of?: string[];
  min_events_total?: number;
  min_unique_event_names?: number;
  important_event_names_any_of?: string[];
}

export interface NegativeSignals {
  forbidden_event_names?: string[];
  forbidden_domains?: string[];
  disallowed_url_patterns?: string[];
}

export interface JourneyExpectations {
  target_url_patterns_any_of?: string[];
  min_navigation_progress_score?: number;
  must_reach_high_value_state?: boolean;
}

export interface Budgets {
  max_action_steps: number;
  max_tool_calls?: number;
  max_no_progress_actions?: number;
}

export interface GraderConfig {
  type: "heuristic" | "strict";
  strictness?: "low" | "medium" | "high";
}

export interface SignalBackedCase {
  $schema: string;
  case_id: string;
  site_id: string;
  family_id?: string | null;
  kind: "local" | "live" | "promoted";
  entry_url: string;
  journey_hint: string;
  tags?: string[];
  difficulty?: "easy" | "medium" | "hard";
  allowed_actions?: string[];
  expected_signals: ExpectedSignals;
  negative_signals?: NegativeSignals;
  journey_expectations?: JourneyExpectations;
  budgets: Budgets;
  grader: GraderConfig;
  human_baseline_id?: string | null;
  notes?: string;
}

