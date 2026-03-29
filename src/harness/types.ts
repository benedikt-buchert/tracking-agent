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

// ─── Human Baseline ──────────────────────────────────────────────────────────

export interface HumanBaseline {
  $schema: string;
  human_baseline_id: string;
  case_id: string;
  source: string;
  action_steps_total: number;
  milestones?: string[];
  playbook_path?: string | null;
  notes?: string;
}

// ─── Run Result ───────────────────────────────────────────────────────────────

export type RunLane =
  | "discovery_known"
  | "discovery_promoted"
  | "discovery_live_target"
  | "discovery_live_holdout";

export type RunStatus = "passed" | "failed" | "error" | "skipped";

export interface RunOutcome {
  status: RunStatus;
  tracking_surface_found?: boolean;
  journey_completed?: boolean;
  important_event_detected?: boolean;
  human_intervention_needed?: boolean;
  failure_class?: string | null;
  failure_summary?: string | null;
}

export interface RunMetrics {
  action_steps_total: number;
  tool_calls_total: number;
  elapsed_ms?: number;
  ms_per_action_step?: number;
  navigation_count?: number;
  unique_pages_visited?: number;
  events_extracted_total: number;
  unique_event_names: number;
  observed_event_names?: string[];
  important_events_found?: number;
  navigation_progress_score?: number;
  stuck_loops_detected?: number;
  repeated_action_count?: number;
  no_progress_action_streak_max?: number;
  token_input?: number;
  token_output?: number;
  estimated_cost_usd?: number;
}

export interface HumanComparison {
  human_baseline_available: boolean;
  human_action_steps_total?: number;
  step_ratio_vs_human?: number;
  extra_steps_vs_human?: number;
  milestone_recall_vs_human?: number;
}

export interface RunArtifacts {
  log_path?: string | null;
  report_path?: string | null;
  session_path?: string | null;
  playbook_path?: string | null;
  trace_path?: string | null;
  screenshots_dir?: string | null;
  dom_snapshot_dir?: string | null;
}

export interface RunResult {
  $schema: string;
  run_id: string;
  timestamp: string;
  git_commit: string;
  case_id: string;
  site_id: string;
  family_id?: string | null;
  lane: RunLane;
  outcome: RunOutcome;
  metrics: RunMetrics;
  human_comparison?: HumanComparison | null;
  artifacts?: RunArtifacts;
}
