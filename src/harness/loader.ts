import { readFile } from "fs/promises";
import type { SignalBackedCase, HumanBaseline } from "./types.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ─── Case Validation ─────────────────────────────────────────────────────────

const VALID_KINDS = new Set(["local", "live", "promoted"]);
const VALID_GRADER_TYPES = new Set(["heuristic", "strict"]);
const VALID_DIFFICULTIES = new Set(["easy", "medium", "hard"]);
const VALID_STRICTNESS = new Set(["low", "medium", "high"]);

function validateCaseScalars(d: Record<string, unknown>, errors: string[]): void {
  if (typeof d["case_id"] !== "string" || d["case_id"] === "")
    errors.push("case_id must be a non-empty string");
  if (typeof d["site_id"] !== "string" || d["site_id"] === "")
    errors.push("site_id must be a non-empty string");
  if (typeof d["kind"] !== "string" || !VALID_KINDS.has(d["kind"]))
    errors.push(`kind must be one of: ${[...VALID_KINDS].join(", ")}`);
  if (typeof d["entry_url"] !== "string" || d["entry_url"] === "")
    errors.push("entry_url must be a non-empty string");
  if (typeof d["journey_hint"] !== "string" || d["journey_hint"] === "")
    errors.push("journey_hint must be a non-empty string");
  if (d["difficulty"] !== undefined && !VALID_DIFFICULTIES.has(d["difficulty"] as string))
    errors.push(`difficulty must be one of: ${[...VALID_DIFFICULTIES].join(", ")}`);
}

function validateExpectedSignals(d: Record<string, unknown>, errors: string[]): void {
  const es = d["expected_signals"] as Record<string, unknown> | undefined;
  if (!es || typeof es !== "object") {
    errors.push("expected_signals must be an object");
    return;
  }
  if (!Array.isArray(es["tracking_surfaces"]))
    errors.push("expected_signals.tracking_surfaces must be an array");
  if (es["min_events_total"] !== undefined &&
      (typeof es["min_events_total"] !== "number" || es["min_events_total"] < 0))
    errors.push("expected_signals.min_events_total must be a non-negative integer");
  if (es["min_unique_event_names"] !== undefined &&
      (typeof es["min_unique_event_names"] !== "number" || es["min_unique_event_names"] < 0))
    errors.push("expected_signals.min_unique_event_names must be a non-negative integer");
}

function validateBudgets(d: Record<string, unknown>, errors: string[]): void {
  const budgets = d["budgets"] as Record<string, unknown> | undefined;
  if (!budgets || typeof budgets !== "object") {
    errors.push("budgets must be an object");
    return;
  }
  if (typeof budgets["max_action_steps"] !== "number" || budgets["max_action_steps"] < 1)
    errors.push("budgets.max_action_steps must be a positive integer");
}

function validateGrader(d: Record<string, unknown>, errors: string[]): void {
  const grader = d["grader"] as Record<string, unknown> | undefined;
  if (!grader || typeof grader !== "object") {
    errors.push("grader must be an object");
    return;
  }
  if (typeof grader["type"] !== "string" || !VALID_GRADER_TYPES.has(grader["type"]))
    errors.push(`grader.type must be one of: ${[...VALID_GRADER_TYPES].join(", ")}`);
  if (grader["strictness"] !== undefined && !VALID_STRICTNESS.has(grader["strictness"] as string))
    errors.push(`grader.strictness must be one of: ${[...VALID_STRICTNESS].join(", ")}`);
}

export function validateCase(data: unknown): ValidationResult {
  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["Expected an object"] };
  }
  const d = data as Record<string, unknown>;
  const errors: string[] = [];

  for (const field of ["$schema", "case_id", "site_id", "kind", "entry_url", "journey_hint", "expected_signals", "budgets", "grader"] as const) {
    if (d[field] === undefined || d[field] === null)
      errors.push(`Missing required field: ${field}`);
  }

  validateCaseScalars(d, errors);
  validateExpectedSignals(d, errors);
  validateBudgets(d, errors);
  validateGrader(d, errors);

  return { valid: errors.length === 0, errors };
}

// ─── Human Baseline Validation ────────────────────────────────────────────────

export function validateHumanBaseline(data: unknown): ValidationResult {
  const errors: string[] = [];
  const d = data as Record<string, unknown>;

  if (!d || typeof d !== "object") {
    return { valid: false, errors: ["Expected an object"] };
  }

  const required = ["$schema", "human_baseline_id", "case_id", "source", "action_steps_total"] as const;
  for (const field of required) {
    if (d[field] === undefined || d[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (typeof d["human_baseline_id"] !== "string" || d["human_baseline_id"] === "") {
    errors.push("human_baseline_id must be a non-empty string");
  }
  if (typeof d["case_id"] !== "string" || d["case_id"] === "") {
    errors.push("case_id must be a non-empty string");
  }
  if (typeof d["source"] !== "string" || d["source"] === "") {
    errors.push("source must be a non-empty string");
  }
  if (
    typeof d["action_steps_total"] !== "number" ||
    d["action_steps_total"] < 0
  ) {
    errors.push("action_steps_total must be a non-negative integer");
  }

  return { valid: errors.length === 0, errors };
}

// ─── File Loaders ─────────────────────────────────────────────────────────────

export async function loadCase(filePath: string): Promise<SignalBackedCase> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    throw new Error(`Cannot read case file ${filePath}: ${String(err)}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in case file ${filePath}: ${String(err)}`);
  }

  const result = validateCase(data);
  if (!result.valid) {
    throw new Error(
      `Case file ${filePath} failed validation:\n  ${result.errors.join("\n  ")}`,
    );
  }

  return data as SignalBackedCase;
}

export async function loadHumanBaseline(filePath: string): Promise<HumanBaseline> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    throw new Error(`Cannot read baseline file ${filePath}: ${String(err)}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in baseline file ${filePath}: ${String(err)}`);
  }

  const result = validateHumanBaseline(data);
  if (!result.valid) {
    throw new Error(
      `Baseline file ${filePath} failed validation:\n  ${result.errors.join("\n  ")}`,
    );
  }

  return data as HumanBaseline;
}
