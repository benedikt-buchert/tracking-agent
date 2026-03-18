import { describe, it, expect, vi, afterEach } from "vitest";
import {
  resolveRef,
  extractRefs,
  extractEventName,
  extractDescription,
  extractTrackingTargets,
  extractCanonicalUrl,
  discoverEventSchemas,
  fetchJson,
} from "./schema.js";

// ─── resolveRef ───────────────────────────────────────────────────────────────

describe("resolveRef", () => {
  it("resolves a relative ref against the base URL", () => {
    const result = resolveRef(
      "./web/purchase-event.json",
      "https://example.com/schemas/1.3.0/event-reference.json",
    );
    expect(result).toBe(
      "https://example.com/schemas/1.3.0/web/purchase-event.json",
    );
  });

  it("returns an absolute ref unchanged", () => {
    const abs = "https://other.com/schemas/event.json";
    const result = resolveRef(abs, "https://example.com/entry.json");
    expect(result).toBe(abs);
  });
});

// ─── extractRefs ──────────────────────────────────────────────────────────────

describe("extractRefs", () => {
  it("collects $ref strings from oneOf", () => {
    const schema = {
      oneOf: [{ $ref: "./purchase.json" }, { $ref: "./add-to-cart.json" }],
    };
    expect(extractRefs(schema)).toEqual([
      "./purchase.json",
      "./add-to-cart.json",
    ]);
  });

  it("collects $ref strings from anyOf", () => {
    const schema = {
      anyOf: [{ $ref: "./event-a.json" }],
    };
    expect(extractRefs(schema)).toEqual(["./event-a.json"]);
  });

  it("collects $ref strings from allOf", () => {
    const schema = {
      allOf: [{ $ref: "./base.json" }],
    };
    expect(extractRefs(schema)).toEqual(["./base.json"]);
  });

  it("returns empty array when no refs exist", () => {
    expect(extractRefs({ title: "NoRefs" })).toEqual([]);
  });

  it("returns empty array for non-object input", () => {
    expect(extractRefs(null)).toEqual([]);
    expect(extractRefs("string")).toEqual([]);
    expect(extractRefs(42)).toEqual([]);
  });

  it("skips items without a $ref string", () => {
    const schema = {
      oneOf: [
        { $ref: "./valid.json" },
        { type: "object" },
        { $ref: 123 }, // not a string — should be skipped
      ],
    };
    expect(extractRefs(schema)).toEqual(["./valid.json"]);
  });
});

// ─── extractEventName ─────────────────────────────────────────────────────────

describe("extractEventName", () => {
  it("returns properties.event.const when present", () => {
    const schema = {
      properties: { event: { const: "purchase" } },
    };
    expect(extractEventName(schema)).toBe("purchase");
  });

  it("returns properties.event.enum[0] when const is absent", () => {
    const schema = {
      properties: { event: { enum: ["add_to_cart", "other"] } },
    };
    expect(extractEventName(schema)).toBe("add_to_cart");
  });

  it("returns title when properties.event is absent", () => {
    const schema = { title: "PageView" };
    expect(extractEventName(schema)).toBe("PageView");
  });

  it("returns undefined when nothing matches", () => {
    expect(extractEventName({ description: "no name here" })).toBeUndefined();
    expect(extractEventName(null)).toBeUndefined();
    expect(extractEventName("string")).toBeUndefined();
  });

  it("prefers const over enum", () => {
    const schema = {
      properties: { event: { const: "checkout", enum: ["checkout", "other"] } },
    };
    expect(extractEventName(schema)).toBe("checkout");
  });
});

// ─── extractDescription ───────────────────────────────────────────────────────

describe("extractDescription", () => {
  it("returns the top-level description string", () => {
    expect(extractDescription({ description: "Fires on purchase." })).toBe(
      "Fires on purchase.",
    );
  });

  it("returns undefined when description is absent", () => {
    expect(extractDescription({ title: "No desc" })).toBeUndefined();
  });

  it("returns undefined when description is not a string", () => {
    expect(extractDescription({ description: 42 })).toBeUndefined();
  });

  it("returns undefined for non-object input", () => {
    expect(extractDescription(null)).toBeUndefined();
    expect(extractDescription(undefined)).toBeUndefined();
    expect(extractDescription("string")).toBeUndefined();
  });
});

// ─── fetchJson ────────────────────────────────────────────────────────────────

describe("fetchJson", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed JSON on a successful response", async () => {
    const mockResponse = { data: "ok" };
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const result = await fetchJson("https://example.com/data.json");
    expect(result).toEqual(mockResponse);
  });

  it("throws on a non-ok response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    await expect(fetchJson("https://example.com/missing.json")).rejects.toThrow(
      "HTTP 404",
    );
  });
});

// ─── extractTrackingTargets ───────────────────────────────────────────────────

describe("extractTrackingTargets", () => {
  it("returns the x-tracking-targets array when present", () => {
    const schema = {
      "x-tracking-targets": ["web-datalayer-js", "server-side"],
    };
    expect(extractTrackingTargets(schema)).toEqual([
      "web-datalayer-js",
      "server-side",
    ]);
  });

  it("filters out non-string tracking targets", () => {
    const schema = {
      "x-tracking-targets": ["web-datalayer-js", 42, null, "server-side"],
    };
    expect(extractTrackingTargets(schema)).toEqual([
      "web-datalayer-js",
      "server-side",
    ]);
  });

  it("returns an empty array when x-tracking-targets is absent", () => {
    expect(extractTrackingTargets({ title: "No targets" })).toEqual([]);
  });

  it("returns an empty array for non-object input", () => {
    expect(extractTrackingTargets(null)).toEqual([]);
    expect(extractTrackingTargets("string")).toEqual([]);
  });

  it("returns an empty array when x-tracking-targets is not an array", () => {
    expect(
      extractTrackingTargets({ "x-tracking-targets": "web-datalayer-js" }),
    ).toEqual([]);
  });
});

// ─── extractCanonicalUrl ──────────────────────────────────────────────────────

describe("extractCanonicalUrl", () => {
  it("returns the $schema const URL from properties", () => {
    const schema = {
      properties: {
        $schema: {
          type: "string",
          const: "https://example.com/schemas/purchase.json",
        },
      },
    };
    expect(extractCanonicalUrl(schema)).toBe(
      "https://example.com/schemas/purchase.json",
    );
  });

  it("returns undefined when properties.$schema has no const", () => {
    const schema = {
      properties: { $schema: { type: "string" } },
    };
    expect(extractCanonicalUrl(schema)).toBeUndefined();
  });

  it("returns undefined when properties.$schema is absent", () => {
    const schema = { properties: { event: { const: "purchase" } } };
    expect(extractCanonicalUrl(schema)).toBeUndefined();
  });

  it("returns undefined when properties is null", () => {
    const schema = { properties: null };
    expect(extractCanonicalUrl(schema)).toBeUndefined();
  });

  it("returns undefined when properties is absent", () => {
    expect(extractCanonicalUrl({ title: "No props" })).toBeUndefined();
  });

  it("returns undefined for non-object input", () => {
    expect(extractCanonicalUrl(null)).toBeUndefined();
    expect(extractCanonicalUrl(undefined)).toBeUndefined();
    expect(extractCanonicalUrl("string")).toBeUndefined();
  });

  it("returns undefined when const is not a string", () => {
    const schema = { properties: { $schema: { const: 42 } } };
    expect(extractCanonicalUrl(schema)).toBeUndefined();
  });

  it("returns undefined when properties.$schema is null", () => {
    const schema = { properties: { $schema: null } };
    expect(extractCanonicalUrl(schema)).toBeUndefined();
  });
});

// ─── discoverEventSchemas ─────────────────────────────────────────────────────

describe("discoverEventSchemas", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns event schemas discovered from an entry schema with oneOf refs", async () => {
    const entryUrl = "https://example.com/schemas/entry.json";
    const entrySchema = {
      oneOf: [
        { $ref: "./web/purchase.json" },
        { $ref: "./web/add-to-cart.json" },
      ],
    };
    const purchaseSchema = {
      description: "Fires when a user completes a purchase.",
      properties: { event: { const: "purchase" } },
    };
    const addToCartSchema = {
      properties: { event: { const: "add_to_cart" } },
    };

    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => entrySchema,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => purchaseSchema,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => addToCartSchema,
      } as Response);

    const result = await discoverEventSchemas(entryUrl);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      eventName: "purchase",
      schemaUrl: "https://example.com/schemas/web/purchase.json",
      description: "Fires when a user completes a purchase.",
      canonicalUrl: undefined,
    });
    expect(result[1]).toEqual({
      eventName: "add_to_cart",
      schemaUrl: "https://example.com/schemas/web/add-to-cart.json",
      description: undefined,
      canonicalUrl: undefined,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("filters sub-schemas by trackingTarget when provided", async () => {
    const entryUrl = "https://example.com/schemas/entry.json";
    const entrySchema = {
      oneOf: [
        { $ref: "./web/purchase.json" },
        { $ref: "./web/server-event.json" },
        { $ref: "./web/no-target.json" },
      ],
    };
    const purchaseSchema = {
      "x-tracking-targets": ["web-datalayer-js"],
      properties: { event: { const: "purchase" } },
    };
    const serverSchema = {
      "x-tracking-targets": ["server-side"],
      properties: { event: { const: "server_purchase" } },
    };
    const noTargetSchema = {
      // no x-tracking-targets — excluded when a filter is active
      properties: { event: { const: "untagged_event" } },
    };

    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => entrySchema,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => purchaseSchema,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => serverSchema,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => noTargetSchema,
      } as Response);

    const result = await discoverEventSchemas(entryUrl, "web-datalayer-js");

    expect(result).toHaveLength(1);
    expect(result[0].eventName).toBe("purchase");
  });

  it("includes all sub-schemas when no trackingTarget is specified", async () => {
    const entryUrl = "https://example.com/schemas/entry.json";
    const entrySchema = {
      oneOf: [{ $ref: "./web/purchase.json" }, { $ref: "./web/server.json" }],
    };
    const purchaseSchema = {
      "x-tracking-targets": ["web-datalayer-js"],
      properties: { event: { const: "purchase" } },
    };
    const serverSchema = {
      "x-tracking-targets": ["server-side"],
      properties: { event: { const: "server_purchase" } },
    };

    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => entrySchema,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => purchaseSchema,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => serverSchema,
      } as Response);

    const result = await discoverEventSchemas(entryUrl);
    expect(result).toHaveLength(2);
  });

  it("skips sub-schemas where no event name can be extracted", async () => {
    const entryUrl = "https://example.com/schemas/entry.json";
    const entrySchema = {
      oneOf: [{ $ref: "./web/purchase.json" }, { $ref: "./web/unknown.json" }],
    };
    const purchaseSchema = {
      properties: { event: { const: "purchase" } },
    };
    const unknownSchema = { description: "no event name" };

    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => entrySchema,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => purchaseSchema,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => unknownSchema,
      } as Response);

    const result = await discoverEventSchemas(entryUrl);

    expect(result).toHaveLength(1);
    expect(result[0].eventName).toBe("purchase");
  });
});
