import type { RunResult } from "./types.js";

// ─── Scorecard types ─────────────────────────────────────────────────────────

interface ScorecardRow {
  case_id: string;
  site_id: string;
  lane: string;
  status: string;
  action_steps_total: number;
  tool_calls_total: number;
  events_extracted_total: number;
  unique_event_names: number;
  failure_summary: string | null;
}

interface Scorecard {
  git_commit: string;
  total: number;
  passed: number;
  failed: number;
  rows: ScorecardRow[];
}

// ─── Builder ─────────────────────────────────────────────────────────────────

export function buildScorecard(results: RunResult[]): Scorecard {
  const rows: ScorecardRow[] = results.map((r) => ({
    case_id: r.case_id,
    site_id: r.site_id,
    lane: r.lane,
    status: r.outcome.status,
    action_steps_total: r.metrics.action_steps_total,
    tool_calls_total: r.metrics.tool_calls_total,
    events_extracted_total: r.metrics.events_extracted_total,
    unique_event_names: r.metrics.unique_event_names,
    failure_summary: r.outcome.failure_summary ?? null,
  }));

  const passed = results.filter((r) => r.outcome.status === "passed").length;
  const failed = results.filter((r) => r.outcome.status !== "passed").length;

  return {
    git_commit: results[0]?.git_commit ?? "unknown",
    total: results.length,
    passed,
    failed,
    rows,
  };
}

// ─── Formatter ────────────────────────────────────────────────────────────────

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

export function formatScorecard(sc: Scorecard): string {
  if (sc.total === 0) {
    return "No results.\n";
  }

  const header = [
    pad("case_id", 30),
    pad("status", 8),
    pad("steps", 7),
    pad("tools", 7),
    pad("events", 8),
    pad("unique", 7),
    "failure",
  ].join("  ");

  const separator = "-".repeat(header.length);

  const rowLines = sc.rows.map((row) => {
    const statusMark = row.status === "passed" ? "PASS" : "FAIL";
    const failure = row.failure_summary ? row.failure_summary.slice(0, 50) : "";
    return [
      pad(row.case_id, 30),
      pad(statusMark, 8),
      pad(String(row.action_steps_total), 7),
      pad(String(row.tool_calls_total), 7),
      pad(String(row.events_extracted_total), 8),
      pad(String(row.unique_event_names), 7),
      failure,
    ].join("  ");
  });

  const summary = `${sc.passed} passed, ${sc.failed} failed  (commit: ${sc.git_commit})`;

  return [header, separator, ...rowLines, separator, summary, ""].join("\n");
}

// ─── File loader ─────────────────────────────────────────────────────────────
