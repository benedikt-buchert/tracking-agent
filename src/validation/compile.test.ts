import { describe, expect, it, vi } from "vitest";
import { compileValidator, formatAjvError } from "./compile.js";

describe("compileValidator", () => {
  it("returns valid:true for data matching the schema", async () => {
    const schema = {
      type: "object",
      required: ["event"],
      properties: { event: { type: "string" } },
    };

    const validate = await compileValidator(schema);

    expect(validate({ event: "purchase" })).toEqual({ valid: true, errors: [] });
  });

  it("returns valid:false with error strings for data violating the schema", async () => {
    const schema = {
      type: "object",
      required: ["event"],
      properties: { event: { type: "string" } },
    };

    const validate = await compileValidator(schema);
    const result = validate({});

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(typeof result.errors[0]).toBe("string");
  });

  it("resolves $ref schemas via the loadSchemaFn", async () => {
    const itemSchema = {
      $id: "https://example.com/item.json",
      type: "object",
      required: ["sku"],
      properties: { sku: { type: "string" } },
    };
    const mainSchema = {
      $schema: "http://json-schema.org/draft-07/schema#",
      $id: "https://example.com/order.json",
      type: "object",
      required: ["item"],
      properties: { item: { $ref: "https://example.com/item.json" } },
    };
    const loadSchemaFn = vi.fn().mockResolvedValue(itemSchema);

    const validate = await compileValidator(mainSchema, loadSchemaFn);

    expect(validate({ item: { sku: "ABC" } })).toEqual({ valid: true, errors: [] });
    expect(validate({ item: {} })).toMatchObject({ valid: false });
  });

  it("selects Ajv2020 for draft 2020-12 schemas", async () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { value: { type: "number", minimum: 0 } },
    };

    const validate = await compileValidator(schema);

    expect(validate({ value: 5 })).toEqual({ valid: true, errors: [] });
    expect(validate({ value: -1 })).toMatchObject({ valid: false });
  });

  it("selects AjvDraft4 for draft-04 schemas", async () => {
    const schema = {
      $schema: "http://json-schema.org/draft-04/schema#",
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    };

    const validate = await compileValidator(schema);

    expect(validate({ name: "Alice" })).toEqual({ valid: true, errors: [] });
    expect(validate({})).toMatchObject({ valid: false });
  });
});

describe("formatAjvError", () => {
  it("formats const errors as: <path> must equal <value>", () => {
    expect(
      formatAjvError({
        instancePath: "/event",
        keyword: "const",
        params: { allowedValue: "purchase" },
        message: "must be equal to constant",
      }),
    ).toBe('/event must equal "purchase"');
  });

  it("formats required errors as: Missing required property: <name>", () => {
    expect(
      formatAjvError({
        instancePath: "",
        keyword: "required",
        params: { missingProperty: "transactionId" },
        message: "must have required property 'transactionId'",
      }),
    ).toBe("Missing required property: transactionId");
  });

  it("formats additionalProperties errors as: Unexpected property: <name>", () => {
    expect(
      formatAjvError({
        instancePath: "",
        keyword: "additionalProperties",
        params: { additionalProperty: "typo_field" },
        message: "must NOT have additional properties",
      }),
    ).toBe("Unexpected property: typo_field");
  });

  it("prepends instancePath for type and other errors", () => {
    expect(
      formatAjvError({
        instancePath: "/items/0/price",
        keyword: "type",
        params: { type: "number" },
        message: "must be number",
      }),
    ).toBe("/items/0/price must be number");
  });

  it("returns message as-is when instancePath is empty and keyword is unrecognised", () => {
    expect(
      formatAjvError({
        instancePath: "",
        keyword: "minimum",
        params: { limit: 0 },
        message: "must be >= 0",
      }),
    ).toBe("must be >= 0");
  });

  it("passes through plain string errors unchanged", () => {
    expect(formatAjvError("something went wrong")).toBe("something went wrong");
  });

  it("falls back to JSON.stringify for unknown non-string values", () => {
    expect(formatAjvError({ weird: true })).toBe('{"weird":true}');
  });

  it("stringifies null and primitive values", () => {
    expect(formatAjvError(null)).toBe("null");
    expect(formatAjvError(42)).toBe("42");
    expect(formatAjvError(false)).toBe("false");
  });

  it("falls back to JSON.stringify when a structured error has no usable message", () => {
    expect(
      formatAjvError({
        instancePath: "/event",
        keyword: "const",
        params: {},
      }),
    ).toBe('{"instancePath":"/event","keyword":"const","params":{}}');
  });

  it("falls back to the raw message when required params are malformed", () => {
    expect(
      formatAjvError({
        instancePath: "",
        keyword: "required",
        params: { missingProperty: 42 },
        message: "must have required property",
      }),
    ).toBe("must have required property");
  });

  it("falls back to the raw message when additionalProperties params are malformed", () => {
    expect(
      formatAjvError({
        instancePath: "",
        keyword: "additionalProperties",
        params: { additionalProperty: 42 },
        message: "must NOT have additional properties",
      }),
    ).toBe("must NOT have additional properties");
  });

  it("uses an empty prefix when instancePath is not a string", () => {
    expect(
      formatAjvError({
        instancePath: 42,
        keyword: "minimum",
        params: {},
        message: "must be >= 0",
      }),
    ).toBe("must be >= 0");
  });

  it("falls back to message when params is null", () => {
    expect(
      formatAjvError({
        instancePath: "",
        keyword: "const",
        params: null,
        message: "must be equal to constant",
      }),
    ).toBe("must be equal to constant");
  });
});
