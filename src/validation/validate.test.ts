import { afterEach, describe, expect, it, vi } from "vitest";
import { clearValidatorCache, validateEvent } from "./validate.js";

describe("validateEvent", () => {
  const schema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://example.com/purchase.json",
    type: "object",
    required: ["event"],
    properties: { event: { type: "string" } },
  };

  function makeLoadSchemaFn(s: Record<string, unknown>) {
    return vi.fn().mockResolvedValue(s);
  }

  afterEach(() => clearValidatorCache());

  it("returns valid:true when the event matches the schema", async () => {
    const result = await validateEvent(
      { event: "purchase" },
      "https://example.com/purchase.json",
      makeLoadSchemaFn(schema),
    );
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("returns valid:false with errors when the event violates the schema", async () => {
    const result = await validateEvent(
      {},
      "https://example.com/purchase.json",
      makeLoadSchemaFn(schema),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("caches the compiled validator so the schema is only loaded once per URL", async () => {
    const loadSchemaFn = makeLoadSchemaFn(schema);

    await validateEvent({ event: "a" }, "https://example.com/purchase.json", loadSchemaFn);
    await validateEvent({ event: "b" }, "https://example.com/purchase.json", loadSchemaFn);

    expect(loadSchemaFn).toHaveBeenCalledTimes(1);
  });

  it("returns valid:false with a descriptive message when schema loading fails", async () => {
    const loadSchemaFn = vi.fn().mockRejectedValue(new Error("HTTP 404 fetching schema"));

    const result = await validateEvent(
      { event: "purchase" },
      "https://example.com/missing.json",
      loadSchemaFn,
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("404");
  });
});
