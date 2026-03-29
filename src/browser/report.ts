import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import type { EventSchema } from "../schema.js";
import { defaultLoadSchema, validateEvent } from "../validation/index.js";
import type { LoadSchemaFn, ValidationResult } from "../validation/index.js";

interface EventValidationResult {
  index: number;
  event: unknown;
  eventName: string | undefined;
  schemaUrl: string;
  result: ValidationResult;
}

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
  const match = eventSchemas.find((schema) => schema.eventName === eventName);
  return {
    eventName,
    schemaUrl: match?.schemaUrl ?? entryUrl,
    canonicalUrl: match?.canonicalUrl,
  };
}

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
    if (schemaUrl === entryUrl) continue;
    const result = await validateEvent(event, schemaUrl, loadSchemaFn);
    results.push({ index: i, event, eventName, schemaUrl, result });
  }
  return results;
}

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

export function generateReport(
  results: EventValidationResult[],
  expectedNames: string[],
  allEvents?: unknown[],
  eventSchemas?: EventSchema[],
): string {
  const passing = results.filter((result) => result.result.valid);
  const failing = results.filter((result) => !result.result.valid);
  const observedNames = new Set(
    results.map((result) => result.eventName).filter(Boolean),
  );
  const notObserved = expectedNames.filter((name) => !observedNames.has(name));

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
    const schema = eventSchemas?.find(
      (eventSchema) => eventSchema.eventName === result.eventName,
    );
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
    const schema = eventSchemas?.find(
      (eventSchema) => eventSchema.eventName === name,
    );
    const description = schema?.description ? ` — ${schema.description}` : "";
    lines.push(`    - ${name}${description}`);
  }
  lines.push("");
  return lines;
}

function appendLines(target: string[], section: string[]): void {
  if (section.length > 0) target.push(...section);
}

function safeJsonStringify(value: unknown, space?: number): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_key, currentValue) => {
      if (typeof currentValue === "bigint") {
        return currentValue.toString();
      }
      if (currentValue !== null && typeof currentValue === "object") {
        if (seen.has(currentValue)) return "[Circular]";
        seen.add(currentValue);
      }
      return currentValue;
    },
    space,
  );
}

export async function saveReportFolder(
  baseDir: string,
  allEvents: unknown[],
  results: EventValidationResult[],
  _expectedNames: string[],
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
    safeJsonStringify(allEvents, 2),
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
      safeJsonStringify(events, 2),
      "utf8",
    );
  }

  return folderPath;
}

export function mergeUniqueEvents(a: unknown[], b: unknown[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];
  for (const event of [...a, ...b]) {
    const key = safeJsonStringify(event);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(event);
    }
  }
  return result;
}
