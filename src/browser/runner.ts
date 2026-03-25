import { execFile } from "child_process";
import { randomBytes } from "crypto";
import { existsSync } from "fs";
import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import type { EventSchema } from "../schema.js";
import { validateEvent, defaultLoadSchema } from "../validation/index.js";
import type { ValidationResult, LoadSchemaFn } from "../validation/index.js";

export type { ValidationResult };
export const DATA_LAYER_BRIDGE_STORAGE_KEY = "__tracking_agent_dl_events__";
const seenPageBoundaryWarnings = new Set<string>();

/** Generate a short random session ID for isolating parallel agent-browser runs. */
export function generateSessionId(): string {
  return `ta-${randomBytes(4).toString("hex")}`;
}

export function clearSeenPageBoundaryWarnings(): void {
  seenPageBoundaryWarnings.clear();
}

export type BrowserFn = (args: string[]) => Promise<string>;

type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;
type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: { timeout: number },
  callback: ExecFileCallback,
) => unknown;

type ExecFileError = Error & {
  stdout?: string;
  stderr?: string;
};

/**
 * Resolve the agent-browser binary, preferring the local node_modules/.bin
 * version over a global install to avoid version mismatches.
 */
export function resolveAgentBrowserBin(
  existsSyncFn: typeof existsSync = existsSync,
  cwd: string = process.cwd(),
  packageRoot: string = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../..",
  ),
): string {
  const packageLocalBin = resolve(
    packageRoot,
    "node_modules",
    ".bin",
    "agent-browser",
  );
  if (existsSyncFn(packageLocalBin)) return packageLocalBin;

  const cwdLocalBin = resolve(cwd, "node_modules", ".bin", "agent-browser");
  if (existsSyncFn(cwdLocalBin)) return cwdLocalBin;

  return "agent-browser";
}

export function runAgentBrowser(
  args: string[],
  execFileFn: ExecFileFn = execFile,
  sessionId?: string,
): Promise<string> {
  const fullArgs = sessionId ? ["--session", sessionId, ...args] : args;
  return new Promise((res) => {
    execFileFn(
      resolveAgentBrowserBin(),
      fullArgs,
      { timeout: 30_000 },
      (err, stdout, stderr) => {
        if (err) {
          const execErr = err as ExecFileError;
          res(
            execErr.stdout?.trim() ||
              execErr.stderr?.trim() ||
              stderr?.trim() ||
              err.message,
          );
        } else res(stdout?.trim() || stderr?.trim() || "");
      },
    );
  });
}

export function defaultBrowserFn(args: string[]): Promise<string> {
  return runAgentBrowser(args);
}

/**
 * Create a BrowserFn scoped to a unique session. All commands issued through
 * the returned function are isolated from other sessions, enabling safe
 * parallel execution.
 */
export function createSessionBrowserFn(
  sessionId: string = generateSessionId(),
): { browserFn: BrowserFn; sessionId: string } {
  return {
    browserFn: (args: string[]) => runAgentBrowser(args, execFile, sessionId),
    sessionId,
  };
}

export async function runBrowserEval(
  js: string,
  browser: BrowserFn = defaultBrowserFn,
): Promise<string> {
  return browser(["eval", js]);
}

export function parseBrowserJsonArray(text: string): unknown[] {
  try {
    const parsed = JSON.parse(text || "[]");
    const result = typeof parsed === "string" ? JSON.parse(parsed) : parsed;
    return Array.isArray(result) ? (result as unknown[]) : [];
  } catch {
    return [];
  }
}

function parseInterceptorObjectResult(record: Record<string, unknown>): {
  events: unknown[];
  recoveredCount: number;
  recoveredEvents: unknown[];
} {
  return {
    events: Array.isArray(record["events"]) ? record["events"] : [],
    recoveredCount:
      typeof record["recoveredCount"] === "number"
        ? record["recoveredCount"]
        : 0,
    recoveredEvents: Array.isArray(record["recoveredEvents"])
      ? record["recoveredEvents"]
      : [],
  };
}

function parseDrainedInterceptorResult(text: string): {
  events: unknown[];
  recoveredCount: number;
  recoveredEvents: unknown[];
} {
  try {
    const parsed = JSON.parse(text || "[]");
    const result = typeof parsed === "string" ? JSON.parse(parsed) : parsed;

    if (Array.isArray(result)) {
      return { events: result, recoveredCount: 0, recoveredEvents: [] };
    }

    if (result !== null && typeof result === "object") {
      return parseInterceptorObjectResult(result as Record<string, unknown>);
    }

    return { events: [], recoveredCount: 0, recoveredEvents: [] };
  } catch {
    return { events: [], recoveredCount: 0, recoveredEvents: [] };
  }
}

function recoveredEventNames(events: unknown[]): string[] {
  const names = new Set<string>();
  for (const event of events) {
    if (event !== null && typeof event === "object") {
      const name = (event as Record<string, unknown>)["event"];
      if (typeof name === "string") names.add(name);
    }
  }
  return [...names];
}

export async function getCurrentUrl(
  browser: BrowserFn = defaultBrowserFn,
): Promise<string> {
  const out = await runBrowserEval("window.location.href", browser).catch(
    () => "",
  );
  return out.trim().replace(/^"|"$/g, "");
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
  return {
    eventName,
    schemaUrl: match?.schemaUrl ?? entryUrl,
    canonicalUrl: match?.canonicalUrl,
  };
}

// ─── validateAll ──────────────────────────────────────────────────────────────

export async function validateAll(
  events: unknown[],
  eventSchemas: EventSchema[],
  entryUrl: string,
  loadSchemaFn: LoadSchemaFn = defaultLoadSchema,
): Promise<EventValidationResult[]> {
  const results: EventValidationResult[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const { eventName, schemaUrl } = resolveSchemaForEvent(
      event,
      eventSchemas,
      entryUrl,
    );
    // Only validate events that match a known schema — skip GTM internals and unrecognised events
    if (schemaUrl === entryUrl) continue;
    const result = await validateEvent(event, schemaUrl, loadSchemaFn);
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
  const observedNames = new Set(
    results.map((r) => r.eventName).filter(Boolean),
  );
  const notObserved = expectedNames.filter((n) => !observedNames.has(n));

  const lines: string[] = [];

  appendLines(
    lines,
    buildReportHeader(results.length, passing.length, failing.length),
  );
  appendLines(lines, buildCountsSection(allEvents));
  appendLines(lines, buildPassingSection(passing));
  appendLines(lines, buildFailingSection(failing, eventSchemas));
  appendLines(lines, buildMissingSection(notObserved, eventSchemas));
  lines.push("────────────────────────────────────────────────────────────\n");
  return lines.join("\n");
}

function buildReportHeader(
  totalEvents: number,
  passingCount: number,
  failingCount: number,
): string[] {
  return [
    "\n── Tracking Validation Report ──────────────────────────────",
    `  Total events captured: ${totalEvents}`,
    `  Passed: ${passingCount}  Failed: ${failingCount}\n`,
  ];
}

function buildCountsSection(allEvents?: unknown[]): string[] {
  if (!allEvents || allEvents.length === 0) return [];

  const lines = [`  dataLayer pushes (${allEvents.length} total)`];
  for (const [name, count] of countEventsByType(allEvents)) {
    lines.push(`    ${name.padEnd(32)} ×${count}`);
  }
  lines.push("");
  return lines;
}

function buildPassingSection(passing: EventValidationResult[]): string[] {
  if (passing.length === 0) return [];

  const lines = ["  ✔ Passing events"];
  for (const result of passing) {
    lines.push(`    [${result.index}] ${result.eventName ?? "(unnamed)"}`);
  }
  lines.push("");
  return lines;
}

function buildFailingSection(
  failing: EventValidationResult[],
  eventSchemas?: EventSchema[],
): string[] {
  if (failing.length === 0) return [];

  const lines = ["  ✖ Failing events — what needs fixing"];
  for (const result of failing) {
    const schema = eventSchemas?.find((s) => s.eventName === result.eventName);
    lines.push(`    [${result.index}] ${result.eventName ?? "(unnamed)"}`);
    if (schema?.description) {
      lines.push(`        Schema: ${schema.description}`);
    }
    lines.push(`        Schema URL: ${result.schemaUrl}`);
    for (const error of result.result.errors) {
      lines.push(`        ✗ ${error}`);
    }
  }
  lines.push("");
  return lines;
}

function buildMissingSection(
  notObserved: string[],
  eventSchemas?: EventSchema[],
): string[] {
  if (notObserved.length === 0) return [];

  const lines = [
    "  ⚠ Expected events not observed — these are missing from the dataLayer",
  ];
  for (const name of notObserved) {
    const schema = eventSchemas?.find((s) => s.eventName === name);
    const description = schema?.description ? ` — ${schema.description}` : "";
    lines.push(`    - ${name}${description}`);
  }
  lines.push("");
  return lines;
}

function appendLines(target: string[], section: string[]): void {
  if (section.length > 0) {
    target.push(...section);
  }
}

// ─── saveReportFolder ─────────────────────────────────────────────────────────

export async function saveReportFolder(
  baseDir: string,
  allEvents: unknown[],
  results: EventValidationResult[],
  expectedNames: string[],
  report: string,
): Promise<string> {
  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\..+/, "");
  const folderPath = join(baseDir, timestamp);
  await mkdir(folderPath, { recursive: true });

  await writeFile(join(folderPath, "report.txt"), report, "utf8");
  await writeFile(
    join(folderPath, "events.json"),
    JSON.stringify(allEvents, null, 2),
    "utf8",
  );

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
    await writeFile(
      join(byTypeDir, filename),
      JSON.stringify(events, null, 2),
      "utf8",
    );
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

export async function startHeadedBrowser(
  browser: BrowserFn = defaultBrowserFn,
): Promise<void> {
  process.env["AGENT_BROWSER_HEADED"] = "true";
  // Close any running headless daemon so the next call starts a fresh headed instance
  await browser(["close"]).catch(() => {});
}

// ─── closeBrowser ─────────────────────────────────────────────────────────────

export async function closeBrowser(
  browser: BrowserFn = defaultBrowserFn,
): Promise<void> {
  await browser(["close"]).catch(() => {});
}

// ─── navigateTo ───────────────────────────────────────────────────────────────

export async function navigateTo(
  url: string,
  browser: BrowserFn = defaultBrowserFn,
): Promise<void> {
  await browser(["open", url]);
  await browser(["wait", "--load", "networkidle"]);
}

// ─── waitForNavigation ────────────────────────────────────────────────────────
//
// Polls the current URL every `intervalMs` until it differs from `fromUrl`
// (meaning a navigation / redirect happened), then waits for networkidle on the
// new page. Times out after `maxMs` and returns silently if no navigation occurs.

export async function waitForNavigation(
  fromUrl: string,
  browser: BrowserFn = defaultBrowserFn,
  {
    intervalMs = 500,
    maxMs = 10_000,
  }: { intervalMs?: number; maxMs?: number } = {},
): Promise<void> {
  const attempts = Math.ceil(maxMs / intervalMs);
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const currentUrl = await getCurrentUrl(browser).catch(() => fromUrl);
    if (currentUrl !== fromUrl) {
      await browser(["wait", "--load", "networkidle"]).catch(() => {});
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
  const out = await runBrowserEval(js, browser);
  return parseBrowserJsonArray(out);
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
// The interceptor also mirrors new pushes into sessionStorage, so same-origin
// navigations do not lose events emitted immediately before unload.

export async function drainInterceptor(
  browser: BrowserFn = defaultBrowserFn,
): Promise<unknown[]> {
  const js = [
    "(function() {",
    `  var storageKey = ${JSON.stringify(DATA_LAYER_BRIDGE_STORAGE_KEY)};`,
    "  var isFreshInstall = !window.__dl_intercepted;",
    "  if (!window.__dl_intercepted) {",
    "    window.__dl_buffer = [];",
    "    var dl = window.dataLayer;",
    "    if (!Array.isArray(dl)) { window.dataLayer = []; dl = window.dataLayer; }",
    "    for (var i = 0; i < dl.length; i++) { window.__dl_buffer.push(dl[i]); }",
    "    var orig = dl.push;",
    "    dl.push = function() {",
    "      for (var j = 0; j < arguments.length; j++) {",
    "        window.__dl_buffer.push(arguments[j]);",
    "        try {",
    "          var persisted = JSON.parse(sessionStorage.getItem(storageKey) || '[]');",
    "          persisted.push(arguments[j]);",
    "          sessionStorage.setItem(storageKey, JSON.stringify(persisted));",
    "        } catch (e) {}",
    "      }",
    "      return orig.apply(dl, arguments);",
    "    };",
    "    window.__dl_intercepted = true;",
    "  }",
    "  var events = window.__dl_buffer.splice(0);",
    "  var recoveredCount = 0;",
    "  var recoveredEvents = [];",
    "  if (isFreshInstall) {",
    "    try {",
    "      var persistedEvents = JSON.parse(sessionStorage.getItem(storageKey) || '[]');",
    "      sessionStorage.removeItem(storageKey);",
    "      for (var k = 0; k < persistedEvents.length; k++) { events.push(persistedEvents[k]); recoveredEvents.push(persistedEvents[k]); }",
    "      recoveredCount = persistedEvents ? persistedEvents.length : 0;",
    "    } catch (e) {}",
    "  } else {",
    "    try { sessionStorage.removeItem(storageKey); } catch (e) {}",
    "  }",
    "  return JSON.stringify({ events: events, recoveredCount: recoveredCount, recoveredEvents: recoveredEvents });",
    "})()",
  ].join(" ");
  const out = await runBrowserEval(js, browser).catch(() => "");
  const result = parseDrainedInterceptorResult(out);
  if (result.recoveredCount > 0) {
    const warningKey = JSON.stringify(result.recoveredEvents);
    if (!seenPageBoundaryWarnings.has(warningKey)) {
      seenPageBoundaryWarnings.add(warningKey);
      const eventNames = recoveredEventNames(result.recoveredEvents);
      const namesSuffix =
        eventNames.length > 0 ? `: ${eventNames.join(", ")}` : "";
      process.stderr.write(
        `Warning: recovered ${result.recoveredCount} dataLayer event(s) across a page navigation boundary${namesSuffix}. These were fired while leaving the page, so GTM timing may be unreliable on the live site.\n`,
      );
    }
  }
  return result.events;
}

// ─── Session persistence ──────────────────────────────────────────────────────

export interface AgentSession {
  schemaUrl: string;
  targetUrl: string;
  eventSchemas: EventSchema[];
  messages: unknown[];
  foundEventNames?: string[];
  skippedEvents?: { name: string; reason: string }[];
}

export async function saveSession(
  filePath: string,
  session: AgentSession,
): Promise<void> {
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

export async function savePlaybook(
  filePath: string,
  playbook: Playbook,
): Promise<void> {
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
    } catch {
      /* try next */
    }
  }

  // 2. Try bare JSON array
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed: unknown = JSON.parse(arrayMatch[0]);
      if (isValidSteps(parsed)) return parsed;
    } catch {
      /* not valid */
    }
  }

  return null;
}
