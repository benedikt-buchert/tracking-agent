import { describe, it, expect, vi, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";
import { clearValidatorCache } from "../validation/index.js";
import {
  runAgentBrowser,
  runBrowserEval,
  parseBrowserJsonArray,
  getCurrentUrl,
  resolveSchemaForEvent,
  validateAll,
  generateReport,
  navigateTo,
  captureDataLayer,
  drainInterceptor,
  clearSeenPageBoundaryWarnings,
  waitForNavigation,
  mergeUniqueEvents,
  startHeadedBrowser,
  saveSession,
  loadSession,
  isActionTool,
  isStuckOutput,
  replayPlaybook,
  savePlaybook,
  loadPlaybook,
  countEventsByType,
  saveReportFolder,
  extractPlaybookSteps,
} from "./runner.js";
import type {
  EventValidationResult,
  AgentSession,
  PlaybookStep,
  BrowserFn,
} from "./runner.js";
import type { EventSchema } from "../schema.js";

const schemas: EventSchema[] = [
  {
    eventName: "purchase",
    schemaUrl: "https://example.com/schemas/web/purchase.json",
  },
  {
    eventName: "add_to_cart",
    schemaUrl: "https://example.com/schemas/web/add-to-cart.json",
  },
];

const ENTRY_URL = "https://example.com/schemas/entry.json";

// ─── resolveSchemaForEvent ────────────────────────────────────────────────────

describe("resolveSchemaForEvent", () => {
  it("returns matching schema when event name matches", () => {
    const event = { event: "purchase", transactionId: "T123" };
    const result = resolveSchemaForEvent(event, schemas, ENTRY_URL);
    expect(result.eventName).toBe("purchase");
    expect(result.schemaUrl).toBe(
      "https://example.com/schemas/web/purchase.json",
    );
  });

  it("returns entry URL as fallback when no schema matches", () => {
    const event = { event: "unknown_event" };
    const result = resolveSchemaForEvent(event, schemas, ENTRY_URL);
    expect(result.eventName).toBe("unknown_event");
    expect(result.schemaUrl).toBe(ENTRY_URL);
  });

  it("returns entry URL fallback when event has no event field", () => {
    const event = { page: "/home" };
    const result = resolveSchemaForEvent(event, schemas, ENTRY_URL);
    expect(result.eventName).toBeUndefined();
    expect(result.schemaUrl).toBe(ENTRY_URL);
  });

  it("handles non-object events gracefully", () => {
    const result = resolveSchemaForEvent("not-an-object", schemas, ENTRY_URL);
    expect(result.eventName).toBeUndefined();
    expect(result.schemaUrl).toBe(ENTRY_URL);
  });
});

// ─── validateAll ──────────────────────────────────────────────────────────────

describe("validateAll", () => {
  afterEach(() => clearValidatorCache());

  const permissiveSchema = { type: "object" };
  const restrictiveSchema = { type: "object", required: ["_never_present_"] };

  it("validates each event and returns a result per event", async () => {
    const loadSchemaFn = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("purchase.json")) return permissiveSchema;
      return restrictiveSchema;
    });

    const events = [{ event: "purchase" }, { event: "add_to_cart" }];
    const results = await validateAll(events, schemas, ENTRY_URL, loadSchemaFn);

    expect(results).toHaveLength(2);
    expect(results[0].index).toBe(0);
    expect(results[0].eventName).toBe("purchase");
    expect(results[0].result.valid).toBe(true);
    expect(results[1].index).toBe(1);
    expect(results[1].eventName).toBe("add_to_cart");
    expect(results[1].result.valid).toBe(false);
  });

  it("skips events with no schema match (GTM internals, unknown events)", async () => {
    const loadSchemaFn = vi.fn().mockResolvedValue(permissiveSchema);

    const events = [
      { event: "gtm.js" }, // no schema match — skip
      { event: "gtm.dom" }, // no schema match — skip
      { event: "purchase" }, // known schema — validate
    ];
    const results = await validateAll(events, schemas, ENTRY_URL, loadSchemaFn);

    expect(results).toHaveLength(1);
    expect(results[0].eventName).toBe("purchase");
    expect(loadSchemaFn).toHaveBeenCalledTimes(1);
  });

  it("skips events with no event field", async () => {
    const loadSchemaFn = vi.fn().mockResolvedValue(permissiveSchema);

    const results = await validateAll(
      [{ someOtherField: "value" }, { event: "purchase" }],
      schemas,
      ENTRY_URL,
      loadSchemaFn,
    );
    expect(results).toHaveLength(1);
    expect(results[0].eventName).toBe("purchase");
  });

  it("returns an empty array for an empty event list", async () => {
    const results = await validateAll([], schemas, ENTRY_URL);
    expect(results).toEqual([]);
  });

  it("preserves original event indexes when skipped events appear earlier", async () => {
    const loadSchemaFn = vi.fn().mockResolvedValue(permissiveSchema);

    const results = await validateAll(
      [{ event: "gtm.js" }, { event: "purchase" }],
      schemas,
      ENTRY_URL,
      loadSchemaFn,
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.index).toBe(1);
  });
});

// ─── generateReport ───────────────────────────────────────────────────────────

describe("generateReport", () => {
  const passing: EventValidationResult = {
    index: 0,
    event: { event: "purchase" },
    eventName: "purchase",
    schemaUrl: "https://example.com/schemas/web/purchase.json",
    result: { valid: true, errors: [] },
  };
  const failing: EventValidationResult = {
    index: 1,
    event: { event: "add_to_cart" },
    eventName: "add_to_cart",
    schemaUrl: "https://example.com/schemas/web/add-to-cart.json",
    result: { valid: false, errors: ["Missing required field: items"] },
  };

  it("reports total event count", () => {
    const report = generateReport(
      [passing, failing],
      ["purchase", "add_to_cart"],
    );
    expect(report).toContain("  Total events captured: 2");
    expect(report).toContain("  Passed: 1  Failed: 1");
  });

  it("lists passing events", () => {
    const report = generateReport(
      [passing, failing],
      ["purchase", "add_to_cart"],
    );
    expect(report).toContain("purchase");
    expect(report.toLowerCase()).toMatch(/pass|valid/);
  });

  it("lists failing events with their errors", () => {
    const report = generateReport(
      [passing, failing],
      ["purchase", "add_to_cart"],
    );
    expect(report).toContain("add_to_cart");
    expect(report).toContain("Missing required field: items");
  });

  it("lists expected event types that were not observed", () => {
    const report = generateReport(
      [passing],
      ["purchase", "add_to_cart", "page_view"],
    );
    expect(report).toContain("page_view");
    expect(report.toLowerCase()).toMatch(/not observed|missing|expected/);
  });

  it("returns a non-empty string", () => {
    expect(generateReport([], []).length).toBeGreaterThan(0);
  });

  it("includes event occurrence counts when allEvents is provided", () => {
    const allEvents = [
      { event: "purchase" },
      { event: "purchase" },
      { event: "add_to_cart" },
      { event: "gtm.js" },
    ];
    const report = generateReport(
      [passing, failing],
      ["purchase", "add_to_cart"],
      allEvents,
    );
    expect(report).toContain("purchase");
    expect(report).toContain("2");
    expect(report).toContain("gtm.js");
    expect(report).toContain("dataLayer pushes (4 total)");
    expect(report).toContain("purchase                         ×2");
  });

  it("does not add a counts section when allEvents is not provided", () => {
    const report = generateReport(
      [passing, failing],
      ["purchase", "add_to_cart"],
    );
    expect(report).not.toContain("dataLayer pushes");
  });

  it("includes schema descriptions for failing and missing expected events", () => {
    const report = generateReport(
      [failing],
      ["add_to_cart", "page_view"],
      undefined,
      [
        {
          eventName: "add_to_cart",
          schemaUrl: "https://example.com/schemas/web/add-to-cart.json",
          description: "Cart addition",
        },
        {
          eventName: "page_view",
          schemaUrl: "https://example.com/schemas/web/page-view.json",
          description: "Page was viewed",
        },
      ],
    );

    expect(report).toContain("Schema: Cart addition");
    expect(report).toContain("page_view — Page was viewed");
  });

  it("renders the main report sections in a stable order", () => {
    const report = generateReport(
      [passing, failing],
      ["purchase", "add_to_cart", "page_view"],
      [{ event: "purchase" }, { event: "add_to_cart" }],
      [
        {
          eventName: "add_to_cart",
          schemaUrl: "https://example.com/schemas/web/add-to-cart.json",
          description: "Cart addition",
        },
        {
          eventName: "page_view",
          schemaUrl: "https://example.com/schemas/web/page-view.json",
          description: "Page was viewed",
        },
      ],
    );

    const countsIndex = report.indexOf("dataLayer pushes (2 total)");
    const passingIndex = report.indexOf("✔ Passing events");
    const failingIndex = report.indexOf("✖ Failing events");
    const missingIndex = report.indexOf("⚠ Expected events not observed");

    expect(countsIndex).toBeGreaterThan(-1);
    expect(countsIndex).toBeLessThan(passingIndex);
    expect(passingIndex).toBeLessThan(failingIndex);
    expect(failingIndex).toBeLessThan(missingIndex);
  });

  it("omits empty sections when there are no passing, failing, or missing events", () => {
    const report = generateReport([], []);
    expect(report).not.toContain("✔ Passing events");
    expect(report).not.toContain("✖ Failing events");
    expect(report).not.toContain("⚠ Expected events not observed");
  });

  it("omits schema description lines when a failing event has no matching description", () => {
    const report = generateReport([failing], ["add_to_cart"], undefined, [
      {
        eventName: "purchase",
        schemaUrl: "https://example.com/schemas/web/purchase.json",
        description: "Purchase",
      },
    ]);
    expect(report).toContain(
      "Schema URL: https://example.com/schemas/web/add-to-cart.json",
    );
    expect(report).not.toContain("Schema: Cart addition");
  });

  it("uses (unnamed) for passing events without an event name", () => {
    const unnamed: EventValidationResult = {
      index: 2,
      event: { page: "/home" },
      eventName: undefined,
      schemaUrl: "https://example.com/schemas/web/page.json",
      result: { valid: true, errors: [] },
    };
    const report = generateReport([unnamed], []);
    expect(report).toContain("[2] (unnamed)");
  });

  it("omits the missing-events section when every expected event was observed", () => {
    const report = generateReport(
      [passing, failing],
      ["purchase", "add_to_cart"],
    );
    expect(report).not.toContain("⚠ Expected events not observed");
  });

  it("omits the failing-events section when every result is valid", () => {
    const report = generateReport([passing], ["purchase"]);
    expect(report).not.toContain("✖ Failing events");
    expect(report).toContain("✔ Passing events");
  });

  it("omits the passing-events section when every result is invalid", () => {
    const report = generateReport([failing], ["add_to_cart"]);
    expect(report).not.toContain("✔ Passing events");
    expect(report).toContain("✖ Failing events");
  });

  it("uses (unnamed) for failing events without an event name", () => {
    const unnamedFailing: EventValidationResult = {
      index: 3,
      event: { page: "/checkout" },
      eventName: undefined,
      schemaUrl: "https://example.com/schemas/web/unknown.json",
      result: { valid: false, errors: ["Unexpected event format"] },
    };
    const report = generateReport([unnamedFailing], []);
    expect(report).toContain("[3] (unnamed)");
  });
});

// ─── countEventsByType ────────────────────────────────────────────────────────

describe("countEventsByType", () => {
  it("returns correct counts for known events", () => {
    const events = [
      { event: "purchase" },
      { event: "purchase" },
      { event: "add_to_cart" },
    ];
    const counts = countEventsByType(events);
    expect(counts.get("purchase")).toBe(2);
    expect(counts.get("add_to_cart")).toBe(1);
  });

  it("returns an empty map for an empty array", () => {
    expect(countEventsByType([])).toEqual(new Map());
  });

  it("groups events without an event field under (unnamed)", () => {
    const events = [{ page: "/home" }, { gtm: true }];
    const counts = countEventsByType(events);
    expect(counts.get("(unnamed)")).toBe(2);
  });

  it("preserves insertion order", () => {
    const events = [{ event: "b" }, { event: "a" }, { event: "b" }];
    const counts = countEventsByType(events);
    expect([...counts.keys()]).toEqual(["b", "a"]);
  });

  it("groups null and primitive values under (unnamed)", () => {
    const counts = countEventsByType([null, "string", 42, { event: "click" }]);
    expect(counts.get("(unnamed)")).toBe(3);
    expect(counts.get("click")).toBe(1);
  });
});

// ─── saveReportFolder ─────────────────────────────────────────────────────────

describe("saveReportFolder", () => {
  it("creates the folder and returns its path", async () => {
    const baseDir = join(tmpdir(), `tr-test-${randomBytes(4).toString("hex")}`);
    const folderPath = await saveReportFolder(
      baseDir,
      [],
      [],
      [],
      "report text",
    );
    const { stat } = await import("fs/promises");
    const s = await stat(folderPath);
    expect(s.isDirectory()).toBe(true);
  });

  it("writes report.txt with the report content", async () => {
    const baseDir = join(tmpdir(), `tr-test-${randomBytes(4).toString("hex")}`);
    const folderPath = await saveReportFolder(baseDir, [], [], [], "my report");
    const { readFile } = await import("fs/promises");
    const content = await readFile(join(folderPath, "report.txt"), "utf8");
    expect(content).toBe("my report");
  });

  it("writes events.json with all raw events", async () => {
    const baseDir = join(tmpdir(), `tr-test-${randomBytes(4).toString("hex")}`);
    const events = [{ event: "purchase", transactionId: "T1" }];
    const folderPath = await saveReportFolder(baseDir, events, [], [], "");
    const { readFile } = await import("fs/promises");
    const raw = await readFile(join(folderPath, "events.json"), "utf8");
    expect(JSON.parse(raw)).toEqual(events);
  });

  it("creates an events-by-type folder with one file per event type", async () => {
    const baseDir = join(tmpdir(), `tr-test-${randomBytes(4).toString("hex")}`);
    const events = [
      { event: "purchase", transactionId: "T1" },
      { event: "purchase", transactionId: "T2" },
      { event: "add_to_cart", items: [] },
    ];
    const folderPath = await saveReportFolder(baseDir, events, [], [], "");
    const { readFile } = await import("fs/promises");
    const purchases = JSON.parse(
      await readFile(
        join(folderPath, "events-by-type", "purchase.json"),
        "utf8",
      ),
    );
    const cartEvents = JSON.parse(
      await readFile(
        join(folderPath, "events-by-type", "add_to_cart.json"),
        "utf8",
      ),
    );
    expect(purchases).toHaveLength(2);
    expect(cartEvents).toHaveLength(1);
  });

  it("uses a timestamped subfolder name under baseDir", async () => {
    const baseDir = join(tmpdir(), `tr-test-${randomBytes(4).toString("hex")}`);
    const folderPath = await saveReportFolder(baseDir, [], [], [], "");
    expect(folderPath).toContain(baseDir);
    expect(folderPath).not.toBe(baseDir);
  });

  it("groups null and primitive events under (unnamed) in events-by-type", async () => {
    const baseDir = join(tmpdir(), `tr-test-${randomBytes(4).toString("hex")}`);
    // null triggers L350 false branch; { event: 42 } triggers L352 false branch
    const events = [null, 42, { event: 42 }, { event: "purchase" }];
    const folderPath = await saveReportFolder(baseDir, events, [], [], "");
    const { readFile } = await import("fs/promises");
    // "(unnamed)" is sanitized to "_unnamed_" by the filename regex
    const unnamed = JSON.parse(
      await readFile(join(folderPath, "events-by-type", "_unnamed_.json"), "utf8"),
    );
    expect(unnamed).toHaveLength(3);
    const purchases = JSON.parse(
      await readFile(join(folderPath, "events-by-type", "purchase.json"), "utf8"),
    );
    expect(purchases).toHaveLength(1);
  });
});

// ─── navigateTo ───────────────────────────────────────────────────────────────

// ─── mergeUniqueEvents ────────────────────────────────────────────────────────

describe("mergeUniqueEvents", () => {
  it("returns all events when there are no duplicates", () => {
    const a = [{ event: "page_view" }];
    const b = [{ event: "purchase" }];
    expect(mergeUniqueEvents(a, b)).toEqual([
      { event: "page_view" },
      { event: "purchase" },
    ]);
  });

  it("deduplicates identical events by content", () => {
    const event = { event: "page_view", page: "/home" };
    expect(mergeUniqueEvents([event], [event])).toEqual([event]);
  });

  it("preserves events from a when b is empty", () => {
    const a = [{ event: "add_to_cart" }];
    expect(mergeUniqueEvents(a, [])).toEqual(a);
  });

  it("preserves events from b when a is empty", () => {
    const b = [{ event: "purchase" }];
    expect(mergeUniqueEvents([], b)).toEqual(b);
  });

  it("returns empty array when both inputs are empty", () => {
    expect(mergeUniqueEvents([], [])).toEqual([]);
  });
});

// ─── startHeadedBrowser ───────────────────────────────────────────────────────

describe("startHeadedBrowser", () => {
  it("sets AGENT_BROWSER_HEADED env var to true", async () => {
    delete process.env["AGENT_BROWSER_HEADED"];
    const browserFn = vi.fn().mockResolvedValue("");
    await startHeadedBrowser(browserFn);
    expect(process.env["AGENT_BROWSER_HEADED"]).toBe("true");
  });

  it("calls agent-browser close to shut down any running headless daemon", async () => {
    const browserFn = vi.fn().mockResolvedValue("");
    await startHeadedBrowser(browserFn);
    expect(browserFn).toHaveBeenCalledWith(["close"]);
  });
});

describe("navigateTo", () => {
  it("calls the browser CLI with the target URL", async () => {
    const browserFn = vi.fn().mockResolvedValue("Navigated");
    await navigateTo("https://mysite.com", browserFn);
    expect(browserFn.mock.calls).toEqual([
      [["open", "https://mysite.com"]],
      [["wait", "--load", "networkidle"]],
    ]);
  });

  it("resolves without throwing when the browser CLI succeeds", async () => {
    const browserFn = vi.fn().mockResolvedValue("ok");
    await expect(
      navigateTo("https://mysite.com", browserFn),
    ).resolves.toBeUndefined();
  });
});

// ─── captureDataLayer ─────────────────────────────────────────────────────────

describe("captureDataLayer", () => {
  it("returns parsed dataLayer events from the browser", async () => {
    const events = [{ event: "page_view" }, { event: "purchase" }];
    const browserFn = vi.fn().mockResolvedValue(JSON.stringify(events));
    const result = await captureDataLayer(0, browserFn);
    expect(result).toEqual(events);
  });

  it("returns an empty array when dataLayer is empty", async () => {
    const browserFn = vi.fn().mockResolvedValue("[]");
    const result = await captureDataLayer(0, browserFn);
    expect(result).toEqual([]);
  });

  it("passes fromIndex to the browser eval", async () => {
    const browserFn = vi.fn().mockResolvedValue("[]");
    await captureDataLayer(5, browserFn);
    expect(browserFn).toHaveBeenCalledWith([
      "eval",
      "JSON.stringify((window.dataLayer || []).slice(5))",
    ]);
  });

  it("returns an empty array when browser returns empty string", async () => {
    const browserFn = vi.fn().mockResolvedValue("");
    const result = await captureDataLayer(0, browserFn);
    expect(result).toEqual([]);
  });

  it("handles double-encoded output from agent-browser (string wrapping the JSON array)", async () => {
    // agent-browser eval returns string results JSON-encoded, so JSON.stringify(dataLayer)
    // inside eval produces a string, and agent-browser then JSON-encodes that string,
    // outputting "\"[{...}]\"" instead of "[{...}]"
    const events = [{ event: "purchase" }, { event: "page_view" }];
    const doubleEncoded = JSON.stringify(JSON.stringify(events)); // '"[{...}]"'
    const browserFn = vi.fn().mockResolvedValue(doubleEncoded);
    const result = await captureDataLayer(0, browserFn);
    expect(result).toEqual(events);
  });
});

describe("parseBrowserJsonArray", () => {
  it("parses a direct JSON array", () => {
    expect(parseBrowserJsonArray('[{"event":"purchase"}]')).toEqual([
      { event: "purchase" },
    ]);
  });

  it("parses a double-encoded JSON array", () => {
    const encoded = JSON.stringify(JSON.stringify([{ event: "purchase" }]));
    expect(parseBrowserJsonArray(encoded)).toEqual([{ event: "purchase" }]);
  });

  it("returns an empty array for invalid output", () => {
    expect(parseBrowserJsonArray("not-json")).toEqual([]);
  });

  it("returns an empty array when the parsed value is not an array", () => {
    expect(parseBrowserJsonArray('{"event":"purchase"}')).toEqual([]);
  });
});

describe("runBrowserEval", () => {
  it("delegates to the browser with argv", async () => {
    const browserFn = vi.fn().mockResolvedValue("42");
    await expect(runBrowserEval("1 + 1", browserFn)).resolves.toBe("42");
    expect(browserFn).toHaveBeenCalledWith(["eval", "1 + 1"]);
  });
});

describe("getCurrentUrl", () => {
  it("strips wrapping quotes from browser eval output", async () => {
    const browserFn = vi
      .fn()
      .mockResolvedValue('"https://example.com/checkout"');
    await expect(getCurrentUrl(browserFn)).resolves.toBe(
      "https://example.com/checkout",
    );
  });

  it("returns an unquoted URL unchanged", async () => {
    const browserFn = vi.fn().mockResolvedValue("https://example.com/checkout");
    await expect(getCurrentUrl(browserFn)).resolves.toBe(
      "https://example.com/checkout",
    );
  });

  it("returns an empty string when browser eval fails", async () => {
    const browserFn = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(getCurrentUrl(browserFn)).resolves.toBe("");
  });
});

describe("runAgentBrowser", () => {
  it("invokes execFile with argv instead of shell interpolation", async () => {
    const execFileFn = vi.fn((_file, _args, _options, callback) => {
      callback(null, "ok", "");
      return {} as never;
    });

    await expect(
      runAgentBrowser(["open", 'https://example.com?q=a"b'], execFileFn),
    ).resolves.toBe("ok");
    expect(execFileFn).toHaveBeenCalledWith(
      "agent-browser",
      ["open", 'https://example.com?q=a"b'],
      { timeout: 30_000 },
      expect.any(Function),
    );
  });

  it("prefers trimmed stdout when execFile succeeds", async () => {
    const execFileFn = vi.fn((_file, _args, _options, callback) => {
      callback(null, "  from-stdout  ", "  from-stderr  ");
      return {} as never;
    });

    await expect(runAgentBrowser(["snapshot"], execFileFn)).resolves.toBe(
      "from-stdout",
    );
  });

  it("falls back to trimmed stderr when stdout is empty on success", async () => {
    const execFileFn = vi.fn((_file, _args, _options, callback) => {
      callback(null, "   ", "  from-stderr  ");
      return {} as never;
    });

    await expect(runAgentBrowser(["snapshot"], execFileFn)).resolves.toBe(
      "from-stderr",
    );
  });

  it("returns an empty string when both stdout and stderr are empty on success", async () => {
    const execFileFn = vi.fn((_file, _args, _options, callback) => {
      callback(null, "   ", "   ");
      return {} as never;
    });

    await expect(runAgentBrowser(["snapshot"], execFileFn)).resolves.toBe("");
  });

  it("prefers error stdout over error stderr and callback stderr", async () => {
    const error = Object.assign(new Error("failed"), {
      stdout: "  from-error-stdout  ",
      stderr: "  from-error-stderr  ",
    });
    const execFileFn = vi.fn((_file, _args, _options, callback) => {
      callback(error, "ignored", "from-callback-stderr");
      return {} as never;
    });

    await expect(runAgentBrowser(["snapshot"], execFileFn)).resolves.toBe(
      "from-error-stdout",
    );
  });

  it("falls back to error stderr when error stdout is empty", async () => {
    const error = Object.assign(new Error("failed"), {
      stdout: "   ",
      stderr: "  from-error-stderr  ",
    });
    const execFileFn = vi.fn((_file, _args, _options, callback) => {
      callback(error, "ignored", "from-callback-stderr");
      return {} as never;
    });

    await expect(runAgentBrowser(["snapshot"], execFileFn)).resolves.toBe(
      "from-error-stderr",
    );
  });

  it("falls back to callback stderr when error stdout and stderr are empty", async () => {
    const error = Object.assign(new Error("failed"), {
      stdout: "   ",
      stderr: "   ",
    });
    const execFileFn = vi.fn((_file, _args, _options, callback) => {
      callback(error, "ignored", "  from-callback-stderr  ");
      return {} as never;
    });

    await expect(runAgentBrowser(["snapshot"], execFileFn)).resolves.toBe(
      "from-callback-stderr",
    );
  });

  it("falls back to the error message when no stdio output exists", async () => {
    const error = Object.assign(new Error("failed hard"), {
      stdout: "",
      stderr: "",
    });
    const execFileFn = vi.fn((_file, _args, _options, callback) => {
      callback(error, "", "");
      return {} as never;
    });

    await expect(runAgentBrowser(["snapshot"], execFileFn)).resolves.toBe(
      "failed hard",
    );
  });
});

// ─── saveSession / loadSession ────────────────────────────────────────────────

function tmpFile(): string {
  return join(
    tmpdir(),
    `tracking-agent-test-${randomBytes(6).toString("hex")}.json`,
  );
}

describe("saveSession / loadSession", () => {
  it("round-trips a session object through the file system", async () => {
    const session: AgentSession = {
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://example.com",
      eventSchemas: [
        {
          eventName: "purchase",
          schemaUrl: "https://example.com/purchase.json",
        },
      ],
      messages: [{ role: "user", content: "hello" }],
    };
    const path = tmpFile();
    await saveSession(path, session);
    const loaded = await loadSession(path);
    expect(loaded).toEqual(session);
  });

  it("saves valid JSON to disk", async () => {
    const session: AgentSession = {
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://example.com",
      eventSchemas: [],
      messages: [],
    };
    const path = tmpFile();
    await saveSession(path, session);
    const { readFile } = await import("fs/promises");
    const raw = await readFile(path, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("loadSession throws when file does not exist", async () => {
    await expect(loadSession("/nonexistent/path.json")).rejects.toThrow();
  });

  it("preserves all messages in the session", async () => {
    const messages = [
      { role: "user", content: "start" },
      { role: "assistant", content: "ok" },
    ];
    const session: AgentSession = {
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://example.com",
      eventSchemas: [],
      messages,
    };
    const path = tmpFile();
    await saveSession(path, session);
    const loaded = await loadSession(path);
    expect(loaded.messages).toEqual(messages);
  });
});

// ─── isActionTool ─────────────────────────────────────────────────────────────

describe("isActionTool", () => {
  it.each([
    "browser_navigate",
    "browser_click",
    "browser_fill",
    "browser_find",
    "browser_wait",
    "request_human_input",
  ])("returns true for %s", (name) => {
    expect(isActionTool(name)).toBe(true);
  });

  it.each([
    "browser_snapshot",
    "get_datalayer",
    "browser_eval",
    "browser_screenshot",
    "unknown_tool",
  ])("returns false for %s", (name) => {
    expect(isActionTool(name)).toBe(false);
  });
});

// ─── isStuckOutput ────────────────────────────────────────────────────────────

describe("isStuckOutput", () => {
  it("returns true for output starting with 'error'", () => {
    expect(isStuckOutput("Error: element not found")).toBe(true);
  });

  it("returns true for output containing 'not found'", () => {
    expect(isStuckOutput("element @e99 not found on page")).toBe(true);
  });

  it("returns true for output containing 'timeout'", () => {
    expect(isStuckOutput("Navigation timeout exceeded")).toBe(true);
  });

  it("returns true for output starting with 'Command failed'", () => {
    expect(isStuckOutput('Command failed: agent-browser click "#terms"')).toBe(
      true,
    );
  });

  it("returns true for output containing 'timed out'", () => {
    expect(isStuckOutput("Action timed out after 30s")).toBe(true);
  });

  it("returns false for normal success output", () => {
    expect(isStuckOutput("Clicked")).toBe(false);
    expect(isStuckOutput("Navigated successfully")).toBe(false);
    expect(isStuckOutput("")).toBe(false);
    expect(isStuckOutput("Filled")).toBe(false);
  });
});

// ─── replayPlaybook ───────────────────────────────────────────────────────────

describe("replayPlaybook", () => {
  const steps: PlaybookStep[] = [
    { tool: "browser_navigate", args: { url: "https://example.com" } },
    { tool: "browser_click", args: { selector: "#add-to-cart" } },
    {
      tool: "browser_fill",
      args: { selector: "#email", text: "test@test.com" },
    },
  ];

  it("returns stuckAtIndex:-1 when all steps succeed", async () => {
    const executor = vi.fn().mockResolvedValue("ok");
    const result = await replayPlaybook(steps, executor);
    expect(result.stuckAtIndex).toBe(-1);
  });

  it("calls executor for each step in order", async () => {
    const executor = vi.fn().mockResolvedValue("ok");
    await replayPlaybook(steps, executor);
    expect(executor).toHaveBeenCalledTimes(3);
    expect(executor.mock.calls[0][0]).toEqual(steps[0]);
    expect(executor.mock.calls[1][0]).toEqual(steps[1]);
    expect(executor.mock.calls[2][0]).toEqual(steps[2]);
  });

  it("returns stuckAtIndex:0 when the first step fails", async () => {
    const executor = vi.fn().mockResolvedValue("Error: navigation failed");
    const result = await replayPlaybook(steps, executor);
    expect(result.stuckAtIndex).toBe(0);
  });

  it("returns correct stuckAtIndex when a middle step fails", async () => {
    const executor = vi
      .fn()
      .mockResolvedValueOnce("ok")
      .mockResolvedValueOnce("Error: element not found")
      .mockResolvedValue("ok");
    const result = await replayPlaybook(steps, executor);
    expect(result.stuckAtIndex).toBe(1);
  });

  it("stops executing after the first failure", async () => {
    const executor = vi
      .fn()
      .mockResolvedValueOnce("ok")
      .mockResolvedValueOnce("Error: timed out");
    await replayPlaybook(steps, executor);
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("returns stuckAtIndex:-1 for an empty steps array", async () => {
    const executor = vi.fn();
    const result = await replayPlaybook([], executor);
    expect(result.stuckAtIndex).toBe(-1);
    expect(executor).not.toHaveBeenCalled();
  });
});

// ─── extractPlaybookSteps ─────────────────────────────────────────────────────

describe("extractPlaybookSteps", () => {
  const validSteps = [
    { tool: "browser_navigate", args: { url: "https://example.com" } },
    { tool: "browser_click", args: { selector: "#add-to-cart" } },
  ];

  it("extracts steps from a fenced ```json block", () => {
    const text =
      "Here are the steps:\n```json\n" + JSON.stringify(validSteps) + "\n```";
    expect(extractPlaybookSteps(text)).toEqual(validSteps);
  });

  it("extracts steps from a fenced ``` block without language tag", () => {
    const text = "```\n" + JSON.stringify(validSteps) + "\n```";
    expect(extractPlaybookSteps(text)).toEqual(validSteps);
  });

  it("extracts steps from a bare JSON array in the text", () => {
    const text = "Here you go: " + JSON.stringify(validSteps);
    expect(extractPlaybookSteps(text)).toEqual(validSteps);
  });

  it("returns null when the text contains no JSON array", () => {
    expect(extractPlaybookSteps("No JSON here")).toBeNull();
    expect(extractPlaybookSteps("")).toBeNull();
  });

  it("returns null when the JSON array contains items without a tool string", () => {
    const invalid = [{ notATool: "browser_navigate", args: {} }];
    expect(extractPlaybookSteps(JSON.stringify(invalid))).toBeNull();
  });

  it("returns null when the JSON array contains items without an args object", () => {
    const invalid = [{ tool: "browser_navigate", args: "not-an-object" }];
    expect(extractPlaybookSteps(JSON.stringify(invalid))).toBeNull();
  });

  it("returns null when args is null", () => {
    const invalid = [{ tool: "browser_navigate", args: null }];
    expect(extractPlaybookSteps(JSON.stringify(invalid))).toBeNull();
  });

  it("returns an empty array for an empty JSON array", () => {
    expect(extractPlaybookSteps("[]")).toEqual([]);
  });

  it("prefers fenced block over bare array when both are present", () => {
    const fencedSteps = [
      { tool: "browser_navigate", args: { url: "https://fenced.com" } },
    ];
    const bareSteps = [{ tool: "browser_click", args: { selector: "#btn" } }];
    const text =
      "```json\n" +
      JSON.stringify(fencedSteps) +
      "\n```\n" +
      JSON.stringify(bareSteps);
    expect(extractPlaybookSteps(text)).toEqual(fencedSteps);
  });

  it("extracts steps from a pretty-printed multi-line bare JSON array", () => {
    const steps = [
      { tool: "browser_navigate", args: { url: "https://example.com" } },
    ];
    const text = JSON.stringify(steps, null, 2);
    expect(extractPlaybookSteps(text)).toEqual(steps);
  });

  it("returns null when the JSON array contains a null item", () => {
    expect(extractPlaybookSteps("[null]")).toBeNull();
  });

  it("returns null when a fenced block contains a valid JSON non-array (e.g. an object)", () => {
    // isValidSteps receives a non-array, hits the !Array.isArray branch → returns false
    const text = "```json\n{\"tool\":\"nav\",\"args\":{}}\n```";
    expect(extractPlaybookSteps(text)).toBeNull();
  });

  it("returns null when a fenced block contains a non-array primitive", () => {
    const text = "```json\n\"a string\"\n```";
    expect(extractPlaybookSteps(text)).toBeNull();
  });
});

// ─── drainInterceptor ─────────────────────────────────────────────────────────

describe("drainInterceptor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearSeenPageBoundaryWarnings();
  });

  it("recovers persisted page-boundary events and warns with event names", async () => {
    const browserFn = vi.fn().mockResolvedValue(
      JSON.stringify({
        events: [{ event: "purchase" }],
        recoveredCount: 1,
        recoveredEvents: [{ event: "purchase" }],
      }),
    ) as unknown as BrowserFn;
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const result = await drainInterceptor(browserFn);

    expect(result).toEqual([{ event: "purchase" }]);
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining("page navigation boundary"),
    );
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("purchase"));
  });

  it("warns only once for the same recovered page-boundary batch", async () => {
    const browserFn = vi.fn().mockResolvedValue(
      JSON.stringify({
        events: [{ event: "purchase" }],
        recoveredCount: 1,
        recoveredEvents: [{ event: "purchase" }],
      }),
    ) as unknown as BrowserFn;
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await drainInterceptor(browserFn);
    await drainInterceptor(browserFn);

    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it("returns parsed events from the browser eval result", async () => {
    const events = [{ event: "page_view" }, { event: "purchase" }];
    const browserFn = vi
      .fn()
      .mockResolvedValue(JSON.stringify(events)) as unknown as BrowserFn;
    const result = await drainInterceptor(browserFn);
    expect(result).toEqual(events);
  });

  it("returns an empty array when the browser returns an empty JSON array", async () => {
    const browserFn = vi.fn().mockResolvedValue("[]") as unknown as BrowserFn;
    const result = await drainInterceptor(browserFn);
    expect(result).toEqual([]);
  });

  it("handles double-encoded output from agent-browser", async () => {
    const events = [{ event: "add_to_cart" }];
    const doubleEncoded = JSON.stringify(JSON.stringify(events));
    const browserFn = vi
      .fn()
      .mockResolvedValue(doubleEncoded) as unknown as BrowserFn;
    const result = await drainInterceptor(browserFn);
    expect(result).toEqual(events);
  });

  it("returns an empty array when the browser call fails", async () => {
    const browserFn = vi
      .fn()
      .mockRejectedValue(new Error("timeout")) as unknown as BrowserFn;
    const result = await drainInterceptor(browserFn);
    expect(result).toEqual([]);
  });

  it("returns an empty array when browser returns empty string", async () => {
    const browserFn = vi.fn().mockResolvedValue("") as unknown as BrowserFn;
    const result = await drainInterceptor(browserFn);
    expect(result).toEqual([]);
  });

  it("returns an empty array when browser returns a JSON primitive (number)", async () => {
    // parseDrainedInterceptorResult: hits the neither-array-nor-object branch
    const browserFn = vi.fn().mockResolvedValue("42") as unknown as BrowserFn;
    const result = await drainInterceptor(browserFn);
    expect(result).toEqual([]);
  });

  it("returns an empty array when browser returns a JSON boolean", async () => {
    const browserFn = vi
      .fn()
      .mockResolvedValue("true") as unknown as BrowserFn;
    const result = await drainInterceptor(browserFn);
    expect(result).toEqual([]);
  });

  it("handles object result where events field is not an array", async () => {
    // parseInterceptorObjectResult: events branch → else []
    const browserFn = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify({ events: "not-an-array", recoveredCount: 0 }),
      ) as unknown as BrowserFn;
    const result = await drainInterceptor(browserFn);
    expect(result).toEqual([]);
  });

  it("handles object result where recoveredCount field is not a number", async () => {
    // parseInterceptorObjectResult: recoveredCount branch → else 0 (no warning)
    const browserFn = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify({
          events: [{ event: "purchase" }],
          recoveredCount: "one",
          recoveredEvents: [],
        }),
      ) as unknown as BrowserFn;
    const result = await drainInterceptor(browserFn);
    expect(result).toEqual([{ event: "purchase" }]);
  });

  it("passes JS containing __dl_intercepted and __dl_buffer to the browser", async () => {
    const browserFn = vi.fn().mockResolvedValue("[]") as unknown as BrowserFn;
    await drainInterceptor(browserFn);
    const call = vi.mocked(browserFn).mock.calls[0][0];
    expect(call).toEqual(["eval", expect.stringContaining("__dl_intercepted")]);
    expect(call[1]).toContain("__dl_buffer");
    expect(call[1]).toContain("sessionStorage");
  });

  it("does not warn for on-page events that were never across a navigation boundary", async () => {
    // Simulate a same-page drain: interceptor already installed (recoveredCount=0)
    // even though there are real events. The warning must NOT fire.
    const browserFn = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify({ events: [{ event: "add_to_cart" }], recoveredCount: 0 }),
      ) as unknown as BrowserFn;
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const result = await drainInterceptor(browserFn);

    expect(result).toEqual([{ event: "add_to_cart" }]);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("JS uses isFreshInstall to separate boundary recovery from same-page drains", async () => {
    const browserFn = vi.fn().mockResolvedValue("[]") as unknown as BrowserFn;
    await drainInterceptor(browserFn);
    const js = vi.mocked(browserFn).mock.calls[0][0][1] as string;
    // The JS must capture whether this is a fresh install before the install guard
    expect(js).toMatch(/isFreshInstall\s*=\s*!window\.__dl_intercepted/);
    // sessionStorage drain with recoveredCount must be guarded by isFreshInstall
    const freshInstallIdx = js.indexOf("isFreshInstall");
    const recoveredCountIdx = js.indexOf("recoveredCount");
    expect(freshInstallIdx).toBeGreaterThanOrEqual(0);
    expect(recoveredCountIdx).toBeGreaterThanOrEqual(0);
    // The interceptor's push should also push into __dl_buffer for same-page drains
    expect(js).toMatch(/__dl_buffer\.push/);
    // recoveredEvents must be tracked separately from buffer events
    expect(js).toContain("recoveredEvents");
  });

  it("warning names come only from sessionStorage-recovered events, not from buffer events on new page", async () => {
    // Simulate a fresh-install drain where buffer has journey events (rehydrated dataLayer)
    // and sessionStorage has only the actual boundary event
    const browserFn = vi.fn().mockResolvedValue(
      JSON.stringify({
        events: [{ event: "add_to_cart" }, { event: "address_submitted" }],
        recoveredCount: 1,
        recoveredEvents: [{ event: "address_submitted" }],
      }),
    ) as unknown as BrowserFn;
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const result = await drainInterceptor(browserFn);

    expect(result).toEqual([
      { event: "add_to_cart" },
      { event: "address_submitted" },
    ]);
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining("address_submitted"),
    );
    expect(writeSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("add_to_cart"),
    );
  });

  it("omits event name suffix from warning when recovered events have no event field", async () => {
    const browserFn = vi.fn().mockResolvedValue(
      JSON.stringify({
        events: [{ type: "gtm.js" }],
        recoveredCount: 1,
        recoveredEvents: [{ type: "gtm.js" }],
      }),
    ) as unknown as BrowserFn;
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await drainInterceptor(browserFn);

    const warning = writeSpy.mock.calls.map(([t]) => String(t)).join("");
    expect(warning).toContain("page navigation boundary");
    expect(warning).not.toMatch(/boundary:/);
  });

  it("skips null and non-object entries when extracting recovered event names", async () => {
    const browserFn = vi.fn().mockResolvedValue(
      JSON.stringify({
        events: [null, "string", { event: "purchase" }],
        recoveredCount: 3,
        recoveredEvents: [null, "string", { event: "purchase" }],
      }),
    ) as unknown as BrowserFn;
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const result = await drainInterceptor(browserFn);

    expect(result).toEqual([null, "string", { event: "purchase" }]);
    const warning = writeSpy.mock.calls.map(([t]) => String(t)).join("");
    expect(warning).toContain("purchase");
    expect(warning).not.toContain("null");
    expect(warning).not.toContain("string");
  });
});

// ─── waitForNavigation ────────────────────────────────────────────────────────

describe("waitForNavigation", () => {
  it("resolves immediately when URL changes on the first poll", async () => {
    const browserFn = vi
      .fn()
      .mockResolvedValueOnce('"https://example.com/order-received"') // first URL poll
      .mockResolvedValueOnce("ok") as unknown as BrowserFn;
    await waitForNavigation("https://example.com/checkout", browserFn, {
      intervalMs: 1,
      maxMs: 500,
    });
    expect(browserFn).toHaveBeenCalledWith(["eval", "window.location.href"]);
    expect(browserFn).toHaveBeenCalledWith(["wait", "--load", "networkidle"]);
  });

  it("waits until URL changes then calls networkidle", async () => {
    const browserFn = vi
      .fn()
      .mockResolvedValueOnce('"https://example.com/checkout"') // still on checkout
      .mockResolvedValueOnce('"https://example.com/order-received"') // navigated
      .mockResolvedValueOnce("ok") as unknown as BrowserFn;
    await waitForNavigation("https://example.com/checkout", browserFn, {
      intervalMs: 1,
      maxMs: 500,
    });
    const calls = vi.mocked(browserFn).mock.calls.map((c) => c[0]);
    expect(
      calls.filter(
        (c) =>
          JSON.stringify(c) ===
          JSON.stringify(["wait", "--load", "networkidle"]),
      ),
    ).toHaveLength(1);
  });

  it("times out silently when URL never changes", async () => {
    const browserFn = vi
      .fn()
      .mockResolvedValue(
        '"https://example.com/checkout"',
      ) as unknown as BrowserFn;
    await expect(
      waitForNavigation("https://example.com/checkout", browserFn, {
        intervalMs: 1,
        maxMs: 10,
      }),
    ).resolves.toBeUndefined();
    // networkidle should NOT have been called
    const calls = vi.mocked(browserFn).mock.calls.map((c) => c[0]);
    expect(calls).not.toContainEqual(["wait", "--load", "networkidle"]);
  });

  it("polls exactly ceil(maxMs/intervalMs) times before giving up", async () => {
    // intervalMs=2, maxMs=10 → ceil(10/2)=5 attempts.
    // The arithmetic mutant (maxMs*intervalMs=20) would produce 10 attempts;
    // the equality mutant (i<=attempts) would produce 6 attempts.
    const browserFn = vi
      .fn()
      .mockResolvedValue(
        '"https://example.com/checkout"',
      ) as unknown as BrowserFn;
    await waitForNavigation("https://example.com/checkout", browserFn, {
      intervalMs: 2,
      maxMs: 10,
    });
    const evalCalls = vi
      .mocked(browserFn)
      .mock.calls.filter((c) => c[0][0] === "eval");
    expect(evalCalls).toHaveLength(5);
  });
});

// ─── savePlaybook / loadPlaybook ──────────────────────────────────────────────

describe("savePlaybook / loadPlaybook", () => {
  it("round-trips a playbook through the file system", async () => {
    const playbook = {
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://example.com",
      steps: [
        { tool: "browser_navigate", args: { url: "https://example.com" } },
        { tool: "browser_click", args: { selector: "#buy" } },
      ],
    };
    const path = tmpFile();
    await savePlaybook(path, playbook);
    const loaded = await loadPlaybook(path);
    expect(loaded).toEqual(playbook);
  });

  it("loadPlaybook throws when file does not exist", async () => {
    await expect(loadPlaybook("/nonexistent/playbook.json")).rejects.toThrow();
  });
});
