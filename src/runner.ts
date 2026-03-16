import { exec } from "child_process";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import type { EventSchema } from "./schema.js";


export const VALIDATOR_BASE_URL = process.env.VALIDATOR_URL ?? "http://localhost:3000";

export type BrowserFn = (args: string) => Promise<string>;

export function defaultBrowserFn(args: string): Promise<string> {
  return new Promise((resolve) => {
    exec(`agent-browser ${args}`, { timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) resolve(err.stdout?.trim() || err.stderr?.trim() || err.message);
      else resolve(stdout?.trim() || stderr?.trim() || "");
    });
  });
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface EventValidationResult {
  index: number;
  event: unknown;
  eventName: string | undefined;
  schemaUrl: string;
  result: ValidationResult;
}

// ─── resolveSchemaForEvent ────────────────────────────────────────────────────

export function resolveSchemaForEvent(
  event: unknown,
  eventSchemas: EventSchema[],
  entryUrl: string,
): { eventName: string | undefined; schemaUrl: string; canonicalUrl?: string } {
  if (event === null || typeof event !== "object") {
    return { eventName: undefined, schemaUrl: entryUrl };
  }
  const eventName = (event as Record<string, unknown>)["event"];
  if (typeof eventName !== "string") {
    return { eventName: undefined, schemaUrl: entryUrl };
  }
  const match = eventSchemas.find((s) => s.eventName === eventName);
  return { eventName, schemaUrl: match?.schemaUrl ?? entryUrl, canonicalUrl: match?.canonicalUrl };
}

// ─── formatAjvError ───────────────────────────────────────────────────────────

export function formatAjvError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e === null || typeof e !== "object") return JSON.stringify(e);

  const err = e as Record<string, unknown>;
  const instancePath = typeof err["instancePath"] === "string" ? err["instancePath"] : "";
  const keyword = typeof err["keyword"] === "string" ? err["keyword"] : "";
  const params = (err["params"] !== null && typeof err["params"] === "object")
    ? err["params"] as Record<string, unknown>
    : {};
  const message = typeof err["message"] === "string" ? err["message"] : "";
  const prefix = instancePath ? `${instancePath} ` : "";

  switch (keyword) {
    case "const": {
      const allowedValue = params["allowedValue"];
      if (allowedValue !== undefined) return `${prefix}must equal ${JSON.stringify(allowedValue)}`;
      break;
    }
    case "required": {
      const missingProperty = params["missingProperty"];
      if (typeof missingProperty === "string") return `Missing required property: ${missingProperty}`;
      break;
    }
    case "additionalProperties": {
      const additionalProperty = params["additionalProperty"];
      if (typeof additionalProperty === "string") return `Unexpected property: ${additionalProperty}`;
      break;
    }
  }

  return message ? `${prefix}${message}` : JSON.stringify(e);
}

// ─── validateEvent ────────────────────────────────────────────────────────────

export async function validateEvent(
  event: unknown,
  schemaUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<ValidationResult> {
  try {
    const url = `${VALIDATOR_BASE_URL}/v1/validate/remote?schema_url=${encodeURIComponent(schemaUrl)}`;
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    const json = (await res.json()) as { valid: boolean; errors: unknown[] };
    const errors = (json.errors ?? []).map(formatAjvError);
    return { valid: json.valid, errors };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, errors: [`Validator unreachable: ${msg}`] };
  }
}

// ─── validateAll ──────────────────────────────────────────────────────────────

export async function validateAll(
  events: unknown[],
  eventSchemas: EventSchema[],
  entryUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<EventValidationResult[]> {
  const results: EventValidationResult[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const { eventName, schemaUrl } = resolveSchemaForEvent(event, eventSchemas, entryUrl);
    // Only validate events that match a known schema — skip GTM internals and unrecognised events
    if (schemaUrl === entryUrl) continue;
    const result = await validateEvent(event, schemaUrl, fetchFn);
    results.push({ index: i, event, eventName, schemaUrl, result });
  }
  return results;
}

// ─── countEventsByType ────────────────────────────────────────────────────────

export function countEventsByType(events: unknown[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) {
    let key = "(unnamed)";
    if (event !== null && typeof event === "object") {
      const name = (event as Record<string, unknown>)["event"];
      if (typeof name === "string") key = name;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// ─── generateReport ───────────────────────────────────────────────────────────

export function generateReport(
  results: EventValidationResult[],
  expectedNames: string[],
  allEvents?: unknown[],
  eventSchemas?: EventSchema[],
): string {
  const passing = results.filter((r) => r.result.valid);
  const failing = results.filter((r) => !r.result.valid);
  const observedNames = new Set(results.map((r) => r.eventName).filter(Boolean));
  const notObserved = expectedNames.filter((n) => !observedNames.has(n));

  const lines: string[] = [];

  lines.push(`\n── Tracking Validation Report ──────────────────────────────`);
  lines.push(`  Total events captured: ${results.length}`);
  lines.push(`  Passed: ${passing.length}  Failed: ${failing.length}\n`);

  if (allEvents && allEvents.length > 0) {
    const counts = countEventsByType(allEvents);
    lines.push(`  dataLayer pushes (${allEvents.length} total)`);
    for (const [name, count] of counts) {
      lines.push(`    ${name.padEnd(32)} ×${count}`);
    }
    lines.push("");
  }

  if (passing.length > 0) {
    lines.push(`  ✔ Passing events`);
    for (const r of passing) {
      lines.push(`    [${r.index}] ${r.eventName ?? "(unnamed)"}`);
    }
    lines.push("");
  }

  if (failing.length > 0) {
    lines.push(`  ✖ Failing events — what needs fixing`);
    for (const r of failing) {
      const schema = eventSchemas?.find((s) => s.eventName === r.eventName);
      lines.push(`    [${r.index}] ${r.eventName ?? "(unnamed)"}`);
      if (schema?.description) {
        lines.push(`        Schema: ${schema.description}`);
      }
      lines.push(`        Schema URL: ${r.schemaUrl}`);
      for (const err of r.result.errors) {
        lines.push(`        ✗ ${err}`);
      }
    }
    lines.push("");
  }

  if (notObserved.length > 0) {
    lines.push(`  ⚠ Expected events not observed — these are missing from the dataLayer`);
    for (const name of notObserved) {
      const schema = eventSchemas?.find((s) => s.eventName === name);
      const desc = schema?.description ? ` — ${schema.description}` : "";
      lines.push(`    - ${name}${desc}`);
    }
    lines.push("");
  }

  lines.push(`────────────────────────────────────────────────────────────\n`);
  return lines.join("\n");
}

// ─── saveReportFolder ─────────────────────────────────────────────────────────

export async function saveReportFolder(
  baseDir: string,
  allEvents: unknown[],
  results: EventValidationResult[],
  expectedNames: string[],
  report: string,
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
  const folderPath = join(baseDir, timestamp);
  await mkdir(folderPath, { recursive: true });

  await writeFile(join(folderPath, "report.txt"), report, "utf8");
  await writeFile(join(folderPath, "events.json"), JSON.stringify(allEvents, null, 2), "utf8");

  const byTypeDir = join(folderPath, "events-by-type");
  await mkdir(byTypeDir, { recursive: true });

  const groups = new Map<string, unknown[]>();
  for (const event of allEvents) {
    let key = "(unnamed)";
    if (event !== null && typeof event === "object") {
      const name = (event as Record<string, unknown>)["event"];
      if (typeof name === "string") key = name;
    }
    const arr = groups.get(key) ?? [];
    arr.push(event);
    groups.set(key, arr);
  }
  for (const [name, events] of groups) {
    const filename = name.replace(/[^a-zA-Z0-9._-]/g, "_") + ".json";
    await writeFile(join(byTypeDir, filename), JSON.stringify(events, null, 2), "utf8");
  }

  return folderPath;
}

// ─── mergeUniqueEvents ────────────────────────────────────────────────────────

export function mergeUniqueEvents(a: unknown[], b: unknown[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];
  for (const event of [...a, ...b]) {
    const key = JSON.stringify(event);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(event);
    }
  }
  return result;
}

// ─── startHeadedBrowser ───────────────────────────────────────────────────────

export async function startHeadedBrowser(browser: BrowserFn = defaultBrowserFn): Promise<void> {
  process.env["AGENT_BROWSER_HEADED"] = "true";
  // Close any running headless daemon so the next call starts a fresh headed instance
  await browser("close").catch(() => {});
}

// ─── closeBrowser ─────────────────────────────────────────────────────────────

export async function closeBrowser(browser: BrowserFn = defaultBrowserFn): Promise<void> {
  await browser("close").catch(() => {});
}

// ─── navigateTo ───────────────────────────────────────────────────────────────

export async function navigateTo(
  url: string,
  browser: BrowserFn = defaultBrowserFn,
): Promise<void> {
  await browser(`open "${url}" && agent-browser wait --load networkidle`);
}

// ─── waitForNavigation ────────────────────────────────────────────────────────
//
// Polls the current URL every `intervalMs` until it differs from `fromUrl`
// (meaning a navigation / redirect happened), then waits for networkidle on the
// new page. Times out after `maxMs` and returns silently if no navigation occurs.

export async function waitForNavigation(
  fromUrl: string,
  browser: BrowserFn = defaultBrowserFn,
  { intervalMs = 500, maxMs = 10_000 }: { intervalMs?: number; maxMs?: number } = {},
): Promise<void> {
  const attempts = Math.ceil(maxMs / intervalMs);
  for (let i = 0; i < attempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const currentUrl = await browser("eval 'window.location.href'").catch(() => fromUrl);
    if (currentUrl.trim().replace(/^"|"$/g, "") !== fromUrl) {
      await browser("wait --load networkidle").catch(() => {});
      return;
    }
  }
}

// ─── captureDataLayer ─────────────────────────────────────────────────────────

export async function captureDataLayer(
  fromIndex: number,
  browser: BrowserFn = defaultBrowserFn,
): Promise<unknown[]> {
  const js = `JSON.stringify((window.dataLayer || []).slice(${fromIndex}))`;
  const escaped = js.replace(/'/g, `'\\''`);
  const out = await browser(`eval '${escaped}'`);
  try {
    const parsed = JSON.parse(out || "[]");
    // agent-browser eval JSON-encodes string results, so JSON.stringify(dataLayer) inside
    // the eval produces a string that agent-browser wraps in quotes. Double-parse if needed.
    const result = typeof parsed === "string" ? JSON.parse(parsed) : parsed;
    return Array.isArray(result) ? result as unknown[] : [];
  } catch {
    return [];
  }
}

// ─── drainInterceptor ─────────────────────────────────────────────────────────
//
// Injects a dataLayer interceptor into the current page (if not already present)
// and drains all buffered events. On a fresh/navigated page, captures everything
// already in window.dataLayer before setting up the interceptor.
//
// Call this after any browser action that might trigger a page navigation.
// If the page has changed, the interceptor is gone — this auto-detects that,
// re-installs, and returns the full dataLayer from the new page.
//
// The injected JS avoids single quotes so it is safe to wrap in shell
// single-quote delimiters for agent-browser eval '...'.

export async function drainInterceptor(
  browser: BrowserFn = defaultBrowserFn,
): Promise<unknown[]> {
  const js = [
    "(function() {",
    "  if (!window.__dl_intercepted) {",
    "    window.__dl_buffer = [];",
    "    var dl = window.dataLayer;",
    "    if (!Array.isArray(dl)) { window.dataLayer = []; dl = window.dataLayer; }",
    "    for (var i = 0; i < dl.length; i++) { window.__dl_buffer.push(dl[i]); }",
    "    var orig = dl.push;",
    "    dl.push = function() { for (var j = 0; j < arguments.length; j++) { window.__dl_buffer.push(arguments[j]); } return orig.apply(dl, arguments); };",
    "    window.__dl_intercepted = true;",
    "  }",
    "  var events = window.__dl_buffer.splice(0);",
    "  return JSON.stringify(events);",
    "})()",
  ].join(" ");
  const escaped = js.replace(/'/g, `'\\''`);
  const out = await browser(`eval '${escaped}'`).catch(() => "");
  try {
    const parsed = JSON.parse(out || "[]");
    const result = typeof parsed === "string" ? JSON.parse(parsed) : parsed;
    return Array.isArray(result) ? result as unknown[] : [];
  } catch {
    return [];
  }
}

// ─── Session persistence ──────────────────────────────────────────────────────

export interface AgentSession {
  schemaUrl: string;
  targetUrl: string;
  eventSchemas: EventSchema[];
  messages: unknown[];
}

export async function saveSession(filePath: string, session: AgentSession): Promise<void> {
  await writeFile(filePath, JSON.stringify(session, null, 2), "utf8");
}

export async function loadSession(filePath: string): Promise<AgentSession> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as AgentSession;
}

// ─── Playbook record / replay ─────────────────────────────────────────────────

export interface PlaybookStep {
  tool: string;
  args: Record<string, unknown>;
}

export interface Playbook {
  schemaUrl: string;
  targetUrl: string;
  steps: PlaybookStep[];
}

const ACTION_TOOLS = new Set([
  "browser_navigate",
  "browser_click",
  "browser_fill",
  "browser_find",
  "browser_wait",
  "request_human_input",
]);

export function isActionTool(toolName: string): boolean {
  return ACTION_TOOLS.has(toolName);
}

export function isStuckOutput(output: string): boolean {
  const lower = output.toLowerCase();
  return (
    lower.startsWith("error") ||
    lower.startsWith("command failed") ||
    lower.includes("not found") ||
    lower.includes("timed out") ||
    lower.includes("timeout")
  );
}

export type StepExecutor = (step: PlaybookStep) => Promise<string>;

export async function replayPlaybook(
  steps: PlaybookStep[],
  executor: StepExecutor,
): Promise<{ stuckAtIndex: number }> {
  for (let i = 0; i < steps.length; i++) {
    const output = await executor(steps[i]);
    if (isStuckOutput(output)) return { stuckAtIndex: i };
  }
  return { stuckAtIndex: -1 };
}

export async function savePlaybook(filePath: string, playbook: Playbook): Promise<void> {
  await writeFile(filePath, JSON.stringify(playbook, null, 2), "utf8");
}

export async function loadPlaybook(filePath: string): Promise<Playbook> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as Playbook;
}

// ─── extractPlaybookSteps ─────────────────────────────────────────────────────

function isValidSteps(val: unknown): val is PlaybookStep[] {
  if (!Array.isArray(val)) return false;
  return val.every(
    (s) =>
      s !== null &&
      typeof s === "object" &&
      typeof (s as Record<string, unknown>)["tool"] === "string" &&
      (s as Record<string, unknown>)["args"] !== null &&
      typeof (s as Record<string, unknown>)["args"] === "object",
  );
}

export function extractPlaybookSteps(text: string): PlaybookStep[] | null {
  // 1. Try fenced ```json ... ``` block
  const fenced = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (fenced) {
    try {
      const parsed: unknown = JSON.parse(fenced[1]);
      if (isValidSteps(parsed)) return parsed;
    } catch { /* try next */ }
  }

  // 2. Try bare JSON array
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed: unknown = JSON.parse(arrayMatch[0]);
      if (isValidSteps(parsed)) return parsed;
    } catch { /* not valid */ }
  }

  return null;
}
