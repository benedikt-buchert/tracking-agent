import { describe, it, expect, vi } from "vitest";
import { parseArgs, resolveArgs } from "./args.js";

describe("parseArgs", () => {
  it("parses --schema and --url flags", () => {
    const result = parseArgs([
      "--schema",
      "https://example.com/schema.json",
      "--url",
      "https://mysite.com",
    ]);
    expect(result.schemaUrl).toBe("https://example.com/schema.json");
    expect(result.targetUrl).toBe("https://mysite.com");
    expect(result.help).toBe(false);
  });

  it("accepts flags in any order", () => {
    const result = parseArgs([
      "--url",
      "https://mysite.com",
      "--schema",
      "https://example.com/schema.json",
    ]);
    expect(result.schemaUrl).toBe("https://example.com/schema.json");
    expect(result.targetUrl).toBe("https://mysite.com");
  });

  it("returns undefined for missing --schema", () => {
    const result = parseArgs(["--url", "https://mysite.com"]);
    expect(result.schemaUrl).toBeUndefined();
    expect(result.targetUrl).toBe("https://mysite.com");
  });

  it("returns undefined for missing --url", () => {
    const result = parseArgs(["--schema", "https://example.com/schema.json"]);
    expect(result.targetUrl).toBeUndefined();
    expect(result.schemaUrl).toBe("https://example.com/schema.json");
  });

  it("returns help:true for --help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("returns all boolean fields as false in the --help shortcircuit", () => {
    const result = parseArgs(["--help"]);
    expect(result.help).toBe(true);
    expect(result.headless).toBe(false);
    expect(result.quiet).toBe(false);
    expect(result.verbose).toBe(false);
  });

  it("returns help:false when no help flag", () => {
    expect(parseArgs([]).help).toBe(false);
  });

  it("sets headless:true when --headless flag is present", () => {
    const result = parseArgs([
      "--schema",
      "https://example.com/s.json",
      "--url",
      "https://x.com",
      "--headless",
    ]);
    expect(result.headless).toBe(true);
  });

  it("uses the last value when a flag is repeated", () => {
    const result = parseArgs([
      "--schema",
      "https://example.com/first.json",
      "--schema",
      "https://example.com/final.json",
      "--url",
      "https://first.example",
      "--url",
      "https://final.example",
    ]);
    expect(result.schemaUrl).toBe("https://example.com/final.json");
    expect(result.targetUrl).toBe("https://final.example");
  });

  it("ignores a trailing flag without a value", () => {
    const result = parseArgs([
      "--schema",
      "https://example.com/schema.json",
      "--url",
    ]);
    expect(result.schemaUrl).toBe("https://example.com/schema.json");
    expect(result.targetUrl).toBeUndefined();
  });

  it("parses --schemas-dir into schemasDir", () => {
    const result = parseArgs([
      "--schema",
      "https://example.com/schema.json",
      "--url",
      "https://mysite.com",
      "--schemas-dir",
      "./local-schemas",
    ]);
    expect(result.schemasDir).toBe("./local-schemas");
  });

  it("returns undefined for schemasDir when --schemas-dir is absent", () => {
    const result = parseArgs([
      "--schema",
      "https://example.com/schema.json",
      "--url",
      "https://mysite.com",
    ]);
    expect(result.schemasDir).toBeUndefined();
  });

  it("parses --credentials into credentials", () => {
    const result = parseArgs([
      "--schema",
      "https://example.com/schema.json",
      "--url",
      "https://mysite.com",
      "--credentials",
      "./creds.json",
    ]);
    expect(result.credentials).toBe("./creds.json");
  });

  it("returns undefined for credentials when --credentials is absent", () => {
    const result = parseArgs([
      "--schema",
      "https://example.com/schema.json",
      "--url",
      "https://mysite.com",
    ]);
    expect(result.credentials).toBeUndefined();
  });

  it("parses --cache-dir into cacheDir", () => {
    const result = parseArgs([
      "--schema",
      "https://example.com/schema.json",
      "--url",
      "https://mysite.com",
      "--cache-dir",
      "agent-cache",
    ]);
    expect(result.cacheDir).toBe("agent-cache");
  });

  it("defaults cacheDir to current directory when --cache-dir is absent", () => {
    const result = parseArgs([
      "--schema",
      "https://example.com/schema.json",
      "--url",
      "https://mysite.com",
    ]);
    expect(result.cacheDir).toBe(".cache");
  });

  it("parses --quiet flag", () => {
    const result = parseArgs(["--schema", "s", "--url", "u", "--quiet"]);
    expect(result.quiet).toBe(true);
    expect(result.verbose).toBe(false);
  });

  it("parses --verbose flag", () => {
    const result = parseArgs(["--schema", "s", "--url", "u", "--verbose"]);
    expect(result.verbose).toBe(true);
    expect(result.quiet).toBe(false);
  });

  it("defaults quiet and verbose to false", () => {
    const result = parseArgs(["--schema", "s", "--url", "u"]);
    expect(result.quiet).toBe(false);
    expect(result.verbose).toBe(false);
  });
});

describe("resolveArgs", () => {
  it("returns null when --help is passed", async () => {
    const result = await resolveArgs(["--help"]);
    expect(result).toBeNull();
  });

  it("returns parsed args when both flags are provided", async () => {
    const result = await resolveArgs([
      "--schema",
      "https://example.com/schema.json",
      "--url",
      "https://mysite.com",
    ]);
    expect(result).toEqual({
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://mysite.com",
      headless: false,
      quiet: false,
      verbose: false,
      cacheDir: ".cache",
    });
  });

  it("prompts for missing --schema", async () => {
    const prompt = vi.fn().mockResolvedValue("https://prompted-schema.json");
    const result = await resolveArgs(["--url", "https://mysite.com"], prompt);
    expect(result?.schemaUrl).toBe("https://prompted-schema.json");
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining("Schema URL"));
  });

  it("prompts for missing --url", async () => {
    const prompt = vi.fn().mockResolvedValue("https://prompted-url.com");
    const result = await resolveArgs(
      ["--schema", "https://example.com/schema.json"],
      prompt,
    );
    expect(result?.targetUrl).toBe("https://prompted-url.com");
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining("Target URL"));
  });

  it("resolves successfully in headless mode when both --schema and --url are provided", async () => {
    const result = await resolveArgs([
      "--headless",
      "--schema",
      "https://example.com/schema.json",
      "--url",
      "https://example.com",
    ]);
    expect(result).toEqual({
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://example.com",
      headless: true,
      quiet: false,
      verbose: false,
      cacheDir: ".cache",
    });
  });

  it("prompts for both when no flags are provided", async () => {
    const answers = ["https://schema.json", "https://site.com"];
    const prompt = async () => answers.shift()!;
    const result = await resolveArgs([], prompt);
    expect(result).toEqual({
      schemaUrl: "https://schema.json",
      targetUrl: "https://site.com",
      headless: false,
      quiet: false,
      verbose: false,
      cacheDir: ".cache",
    });
  });

  it("returns null in headless mode when schema or url is still missing", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const result = await resolveArgs(["--headless"]);
    expect(result).toBeNull();
    expect(stderr).toHaveBeenCalled();
    stderr.mockRestore();
  });

  it("returns null in headless mode when --schema is provided but --url is missing", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const result = await resolveArgs([
      "--headless",
      "--schema",
      "https://example.com/schema.json",
    ]);
    expect(result).toBeNull();
    expect(stderr).toHaveBeenCalled();
    stderr.mockRestore();
  });

  it("passes --schemas-dir through to the resolved CliArgs", async () => {
    const result = await resolveArgs([
      "--schema",
      "https://example.com/schema.json",
      "--url",
      "https://mysite.com",
      "--schemas-dir",
      "./local-schemas",
    ]);
    expect(result?.schemasDir).toBe("./local-schemas");
  });

  it("passes --cache-dir through to the resolved CliArgs", async () => {
    const result = await resolveArgs([
      "--schema",
      "https://example.com/schema.json",
      "--url",
      "https://mysite.com",
      "--cache-dir",
      "agent-cache",
    ]);
    expect(result?.cacheDir).toBe("agent-cache");
  });

  it("passes --credentials through to the resolved CliArgs", async () => {
    const result = await resolveArgs([
      "--schema",
      "https://example.com/schema.json",
      "--url",
      "https://mysite.com",
      "--credentials",
      "./creds.json",
    ]);
    expect(result?.credentials).toBe("./creds.json");
  });
});
