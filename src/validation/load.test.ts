import { describe, expect, it, vi } from "vitest";
import { createLocalFirstLoader, defaultLoadSchema } from "./load.js";

// ─── defaultLoadSchema ────────────────────────────────────────────────────────

describe("defaultLoadSchema", () => {
  it("fetches schema from an HTTP URL", async () => {
    const schema = { $schema: "http://json-schema.org/draft-07/schema#", type: "object" };
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => schema,
    } as Response);

    const result = await defaultLoadSchema("https://example.com/schema.json", fetchFn);

    expect(fetchFn).toHaveBeenCalledWith("https://example.com/schema.json");
    expect(result).toEqual(schema);
  });

  it("throws when the HTTP response is not ok", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);

    await expect(
      defaultLoadSchema("https://example.com/missing.json", fetchFn),
    ).rejects.toThrow("404");
  });

  it("reads schema from an absolute file path", async () => {
    const schema = { type: "object" };
    const readFileFn = vi.fn().mockResolvedValue(JSON.stringify(schema));

    const result = await defaultLoadSchema("/schemas/event.json", undefined, readFileFn);

    expect(readFileFn).toHaveBeenCalledWith("/schemas/event.json", "utf8");
    expect(result).toEqual(schema);
  });

  it("reads schema from a file:// URI", async () => {
    const schema = { type: "object" };
    const readFileFn = vi.fn().mockResolvedValue(JSON.stringify(schema));

    const result = await defaultLoadSchema("file:///schemas/event.json", undefined, readFileFn);

    expect(readFileFn).toHaveBeenCalledWith("/schemas/event.json", "utf8");
    expect(result).toEqual(schema);
  });
});

// ─── createLocalFirstLoader ───────────────────────────────────────────────────

describe("createLocalFirstLoader", () => {
  it("reads from a local file when the URL path exists under schemasDir", async () => {
    const schema = { $id: "https://example.com/schemas/1.0/event.json", type: "object" };
    const readFileFn = vi.fn().mockResolvedValue(JSON.stringify(schema));
    const fetchFn = vi.fn();

    const load = createLocalFirstLoader("/project/fixtures", fetchFn, readFileFn);
    const result = await load("https://example.com/schemas/1.0/event.json");

    expect(readFileFn).toHaveBeenCalledWith("/project/fixtures/schemas/1.0/event.json", "utf8");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(result).toEqual(schema);
  });

  it("falls back to HTTP fetch when the local file is not found", async () => {
    const schema = { type: "object" };
    const readFileFn = vi.fn().mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => schema } as Response);

    const load = createLocalFirstLoader("/project/fixtures", fetchFn, readFileFn);
    const result = await load("https://example.com/schemas/1.0/event.json");

    expect(fetchFn).toHaveBeenCalledWith("https://example.com/schemas/1.0/event.json");
    expect(result).toEqual(schema);
  });

  it("does not attempt local resolution for URLs with no 'schemas/' segment", async () => {
    const schema = { type: "object" };
    const readFileFn = vi.fn();
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => schema } as Response);

    const load = createLocalFirstLoader("/project/fixtures", fetchFn, readFileFn);
    await load("https://example.com/other/path.json");

    expect(readFileFn).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalled();
  });

  it("uses defaultLoadSchema for non-HTTP URIs (file paths pass through)", async () => {
    const schema = { type: "object" };
    const readFileFn = vi.fn().mockResolvedValue(JSON.stringify(schema));
    const fetchFn = vi.fn();

    const load = createLocalFirstLoader("/project/fixtures", fetchFn, readFileFn);
    const result = await load("/absolute/path/schema.json");

    expect(readFileFn).toHaveBeenCalledWith("/absolute/path/schema.json", "utf8");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(result).toEqual(schema);
  });
});
