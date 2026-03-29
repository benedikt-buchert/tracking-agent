import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./schema.js", () => ({
  discoverEventSchemas: vi.fn(),
}));

vi.mock("./validation/index.js", () => ({
  defaultLoadSchema: vi.fn(),
  createLocalFirstLoader: vi.fn(),
}));

import { readFile, writeFile } from "fs/promises";
import { loadRunState, saveRunSession } from "./run-state.js";
import { discoverEventSchemas } from "./schema.js";
import { createLocalFirstLoader, defaultLoadSchema } from "./validation/index.js";

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockDiscover = vi.mocked(discoverEventSchemas);
const mockCreateLocalFirstLoader = vi.mocked(createLocalFirstLoader);

const noop = () => {};
const log = { info: noop, verbose: noop, error: noop } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadRunState", () => {
  it("discovers schemas from URL when not resuming", async () => {
    const schemas = [{ eventName: "purchase", schemaUrl: "https://x/p.json" }];
    mockDiscover.mockResolvedValue(schemas);

    const result = await loadRunState("https://schema-url", false, undefined, log);

    expect(mockDiscover).toHaveBeenCalledWith(
      "https://schema-url",
      "web-datalayer-js",
      defaultLoadSchema,
    );
    expect(result.eventSchemas).toEqual(schemas);
    expect(result.loadSchemaFn).toBe(defaultLoadSchema);
  });

  it("restores session from file when resuming", async () => {
    const session = {
      schemaUrl: "https://schema-url",
      targetUrl: "https://target",
      eventSchemas: [{ eventName: "page_view", schemaUrl: "https://x/pv.json" }],
    };
    mockReadFile.mockResolvedValue(JSON.stringify(session));

    const result = await loadRunState("https://schema-url", true, undefined, log);

    expect(mockReadFile).toHaveBeenCalledWith(
      ".tracking-agent-session.json",
      "utf8",
    );
    expect(result.eventSchemas).toEqual(session.eventSchemas);
  });

  it("uses local-first loader when schemasDir is provided", async () => {
    const localLoader = vi.fn();
    mockCreateLocalFirstLoader.mockReturnValue(localLoader);
    mockDiscover.mockResolvedValue([]);

    const result = await loadRunState("https://schema-url", false, "/schemas", log);

    expect(mockCreateLocalFirstLoader).toHaveBeenCalledWith("/schemas");
    expect(result.loadSchemaFn).toBe(localLoader);
    expect(mockDiscover).toHaveBeenCalledWith(
      "https://schema-url",
      "web-datalayer-js",
      localLoader,
    );
  });
});

describe("saveRunSession", () => {
  it("writes session JSON to the session file", async () => {
    const session = {
      schemaUrl: "https://schema-url",
      targetUrl: "https://target",
      eventSchemas: [],
      foundEventNames: ["page_view"],
    };

    await saveRunSession(session);

    expect(mockWriteFile).toHaveBeenCalledWith(
      ".tracking-agent-session.json",
      JSON.stringify(session, null, 2),
      "utf8",
    );
  });
});
