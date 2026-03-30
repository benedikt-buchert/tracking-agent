import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  countEventsByType,
  generateReport,
  resolveSchemaForEvent,
  saveReportFolder,
  validateAll,
} from "./report.js";
import type { EventSchema } from "../schema.js";

describe("saveReportFolder", () => {
  it("persists report artifacts even when events contain circular references", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "tracking-agent-report-"));
    const circular: Record<string, unknown> = { event: "gtm.click" };
    circular["self"] = circular;

    try {
      const folder = await saveReportFolder(
        baseDir,
        [circular],
        [],
        [],
        "REPORT",
      );

      await expect(readFile(join(folder, "report.txt"), "utf8")).resolves.toBe(
        "REPORT",
      );
      await expect(readFile(join(folder, "events.json"), "utf8")).resolves.toContain(
        "\"event\": \"gtm.click\"",
      );
      await expect(readFile(join(folder, "events.json"), "utf8")).resolves.toContain(
        "\"[Circular]\"",
      );
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});

describe("countEventsByType", () => {
  it("counts named and unnamed events", () => {
    const events = [
      { event: "page_view" },
      { event: "page_view" },
      { event: "purchase" },
      { foo: "bar" },
      null,
    ];
    const counts = countEventsByType(events);
    expect(counts.get("page_view")).toBe(2);
    expect(counts.get("purchase")).toBe(1);
    expect(counts.get("(unnamed)")).toBe(2);
  });

  it("returns empty map for empty events", () => {
    expect(countEventsByType([]).size).toBe(0);
  });
});

describe("resolveSchemaForEvent", () => {
  const schemas: EventSchema[] = [
    {
      eventName: "purchase",
      schemaUrl: "https://example.com/purchase.json",
      canonicalUrl: "https://example.com/purchase",
    },
  ];

  it("returns matching schema URL for known event", () => {
    const result = resolveSchemaForEvent(
      { event: "purchase" },
      schemas,
      "https://fallback",
    );
    expect(result.eventName).toBe("purchase");
    expect(result.schemaUrl).toBe("https://example.com/purchase.json");
  });

  it("returns entry URL for unknown event name", () => {
    const result = resolveSchemaForEvent(
      { event: "unknown_event" },
      schemas,
      "https://fallback",
    );
    expect(result.eventName).toBe("unknown_event");
    expect(result.schemaUrl).toBe("https://fallback");
  });

  it("returns entry URL for non-object event", () => {
    const result = resolveSchemaForEvent(null, schemas, "https://fallback");
    expect(result.eventName).toBeUndefined();
    expect(result.schemaUrl).toBe("https://fallback");
  });

  it("returns entry URL for event without event property", () => {
    const result = resolveSchemaForEvent(
      { foo: "bar" },
      schemas,
      "https://fallback",
    );
    expect(result.eventName).toBeUndefined();
    expect(result.schemaUrl).toBe("https://fallback");
  });
});

describe("validateAll", () => {
  it("skips events that resolve to the entry URL", async () => {
    const events = [{ event: "unknown" }, { foo: "bar" }];
    const results = await validateAll(events, [], "https://entry");
    expect(results).toEqual([]);
  });

  it("validates events that match a schema", async () => {
    const schemas: EventSchema[] = [
      {
        eventName: "purchase",
        schemaUrl: "https://example.com/purchase.json",
      },
    ];
    const mockLoad = vi.fn().mockResolvedValue({
      type: "object",
      properties: { event: { const: "purchase" } },
      required: ["event"],
    });
    const events = [{ event: "purchase" }];
    const results = await validateAll(
      events,
      schemas,
      "https://entry",
      mockLoad,
    );
    expect(results).toHaveLength(1);
    expect(results[0].eventName).toBe("purchase");
    expect(results[0].result.valid).toBe(true);
  });

  it("returns empty results for empty events array", async () => {
    const results = await validateAll([], [], "https://entry");
    expect(results).toEqual([]);
  });
});

describe("generateReport", () => {
  it("generates report with passing events", () => {
    const results = [
      {
        index: 0,
        event: { event: "page_view" },
        eventName: "page_view",
        schemaUrl: "https://example.com/page_view.json",
        result: { valid: true, errors: [] },
      },
    ];
    const report = generateReport(results, ["page_view"]);
    expect(report).toContain("Passed: 1");
    expect(report).toContain("Failed: 0");
    expect(report).toContain("✔ Passing events");
    expect(report).toContain("[0] page_view");
  });

  it("generates report with failing events and descriptions", () => {
    const schemas: EventSchema[] = [
      {
        eventName: "purchase",
        schemaUrl: "https://example.com/purchase.json",
        description: "GA4 purchase event",
      },
    ];
    const results = [
      {
        index: 0,
        event: { event: "purchase" },
        eventName: "purchase",
        schemaUrl: "https://example.com/purchase.json",
        result: { valid: false, errors: ["missing required field: value"] },
      },
    ];
    const report = generateReport(results, ["purchase"], undefined, schemas);
    expect(report).toContain("Failed: 1");
    expect(report).toContain("✖ Failing events");
    expect(report).toContain("[0] purchase");
    expect(report).toContain("Schema: GA4 purchase event");
    expect(report).toContain("✗ missing required field: value");
  });

  it("generates report with missing events and descriptions", () => {
    const schemas: EventSchema[] = [
      {
        eventName: "add_to_cart",
        schemaUrl: "https://example.com/atc.json",
        description: "Add to cart event",
      },
    ];
    const report = generateReport([], ["add_to_cart"], undefined, schemas);
    expect(report).toContain("⚠ Expected events not observed");
    expect(report).toContain("- add_to_cart — Add to cart event");
  });

  it("generates report with missing events without descriptions", () => {
    const report = generateReport([], ["checkout"], undefined, []);
    expect(report).toContain("- checkout");
    expect(report).not.toContain("- checkout —");
  });

  it("generates report with dataLayer counts section", () => {
    const events = [
      { event: "page_view" },
      { event: "page_view" },
      { event: "purchase" },
      { foo: "bar" },
    ];
    const report = generateReport([], [], events);
    expect(report).toContain("dataLayer pushes (4 total)");
    expect(report).toContain("page_view");
    expect(report).toContain("×2");
    expect(report).toContain("purchase");
    expect(report).toContain("(unnamed)");
  });

  it("omits counts section when no allEvents provided", () => {
    const report = generateReport([], []);
    expect(report).not.toContain("dataLayer pushes");
  });

  it("omits counts section for empty allEvents", () => {
    const report = generateReport([], [], []);
    expect(report).not.toContain("dataLayer pushes");
  });

  it("generates report with unnamed passing events", () => {
    const results = [
      {
        index: 0,
        event: { foo: "bar" },
        eventName: undefined as string | undefined,
        schemaUrl: "https://example.com/schema.json",
        result: { valid: true, errors: [] },
      },
    ];
    const report = generateReport(results, []);
    expect(report).toContain("[0] (unnamed)");
  });

  it("generates full report with all sections", () => {
    const schemas: EventSchema[] = [
      {
        eventName: "page_view",
        schemaUrl: "https://example.com/pv.json",
      },
      {
        eventName: "purchase",
        schemaUrl: "https://example.com/purchase.json",
        description: "Purchase event",
      },
    ];
    const results = [
      {
        index: 0,
        event: { event: "page_view" },
        eventName: "page_view",
        schemaUrl: "https://example.com/pv.json",
        result: { valid: true, errors: [] },
      },
      {
        index: 1,
        event: { event: "purchase" },
        eventName: "purchase",
        schemaUrl: "https://example.com/purchase.json",
        result: { valid: false, errors: ["missing value"] },
      },
    ];
    const allEvents = [
      { event: "page_view" },
      { event: "purchase" },
      { event: "gtm.js" },
    ];
    const report = generateReport(
      results,
      ["page_view", "purchase", "add_to_cart"],
      allEvents,
      schemas,
    );
    expect(report).toContain("Total events captured: 2");
    expect(report).toContain("Passed: 1");
    expect(report).toContain("Failed: 1");
    expect(report).toContain("✔ Passing events");
    expect(report).toContain("✖ Failing events");
    expect(report).toContain("⚠ Expected events not observed");
    expect(report).toContain("- add_to_cart");
    expect(report).toContain("dataLayer pushes (3 total)");
  });

  it("generates report with failing event without schema description", () => {
    const results = [
      {
        index: 0,
        event: { event: "custom_event" },
        eventName: "custom_event",
        schemaUrl: "https://example.com/custom.json",
        result: { valid: false, errors: ["bad field"] },
      },
    ];
    const report = generateReport(results, [], undefined, []);
    expect(report).toContain("[0] custom_event");
    expect(report).not.toContain("Schema: ");
    expect(report).toContain("Schema URL: https://example.com/custom.json");
    expect(report).toContain("✗ bad field");
  });
});
