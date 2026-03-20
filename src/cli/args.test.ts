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
    expect(result.resume).toBe(false);
    expect(result.replay).toBe(false);
    expect(result.headless).toBe(false);
  });

  it("returns help:false when no help flag", () => {
    expect(parseArgs([]).help).toBe(false);
  });

  it("sets resume:true when --resume flag is present", () => {
    const result = parseArgs([
      "--schema",
      "https://example.com/s.json",
      "--url",
      "https://x.com",
      "--resume",
    ]);
    expect(result.resume).toBe(true);
  });

  it("sets resume:false when --resume flag is absent", () => {
    const result = parseArgs([
      "--schema",
      "https://example.com/s.json",
      "--url",
      "https://x.com",
    ]);
    expect(result.resume).toBe(false);
  });

  it("sets replay:true when --replay flag is present", () => {
    const result = parseArgs([
      "--schema",
      "https://example.com/s.json",
      "--url",
      "https://x.com",
      "--replay",
    ]);
    expect(result.replay).toBe(true);
  });

  it("sets replay:false when --replay flag is absent", () => {
    const result = parseArgs([
      "--schema",
      "https://example.com/s.json",
      "--url",
      "https://x.com",
    ]);
    expect(result.replay).toBe(false);
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
      resume: false,
      replay: false,
      headless: false,
    });
  });

  it("includes resume:true when --resume is passed", async () => {
    const result = await resolveArgs([
      "--schema",
      "https://example.com/schema.json",
      "--url",
      "https://mysite.com",
      "--resume",
    ]);
    expect(result?.resume).toBe(true);
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
      resume: false,
      replay: false,
      headless: true,
    });
  });

  it("prompts for both when no flags are provided", async () => {
    const answers = ["https://schema.json", "https://site.com"];
    const prompt = async () => answers.shift()!;
    const result = await resolveArgs([], prompt);
    expect(result).toEqual({
      schemaUrl: "https://schema.json",
      targetUrl: "https://site.com",
      resume: false,
      replay: false,
      headless: false,
    });
  });

  it("includes replay:true when --replay is passed", async () => {
    const result = await resolveArgs([
      "--schema",
      "https://example.com/schema.json",
      "--url",
      "https://mysite.com",
      "--replay",
    ]);
    expect(result?.replay).toBe(true);
  });

  it("reads schemaUrl and targetUrl from playbook file when --replay is given without --schema/--url", async () => {
    const playbookContent = JSON.stringify({
      schemaUrl: "https://saved-schema.com/schema.json",
      targetUrl: "https://saved-site.com",
      steps: [],
    });
    const readFileFn = vi.fn().mockResolvedValue(playbookContent);
    const result = await resolveArgs(["--replay"], undefined, readFileFn);
    expect(readFileFn).toHaveBeenCalledWith(".tracking-agent-playbook.json");
    expect(result?.schemaUrl).toBe("https://saved-schema.com/schema.json");
    expect(result?.targetUrl).toBe("https://saved-site.com");
    expect(result?.replay).toBe(true);
  });

  it("reads schemaUrl and targetUrl from session file when --resume is given without --schema/--url", async () => {
    const sessionContent = JSON.stringify({
      schemaUrl: "https://saved-schema.com/schema.json",
      targetUrl: "https://saved-site.com",
      eventSchemas: [],
      messages: [],
    });
    const readFileFn = vi.fn().mockResolvedValue(sessionContent);
    const result = await resolveArgs(["--resume"], undefined, readFileFn);
    expect(readFileFn).toHaveBeenCalledWith(".tracking-agent-session.json");
    expect(result?.schemaUrl).toBe("https://saved-schema.com/schema.json");
    expect(result?.targetUrl).toBe("https://saved-site.com");
    expect(result?.resume).toBe(true);
  });

  it("returns null in headless mode when schema or url is still missing", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const result = await resolveArgs(["--headless"]);
    expect(result).toBeNull();
    expect(stderr).toHaveBeenCalled();
  });

  it("uses saved replay values in headless mode without prompting", async () => {
    const prompt = vi.fn();
    const readFileFn = vi.fn().mockResolvedValue(
      JSON.stringify({
        schemaUrl: "https://saved-schema.com/schema.json",
        targetUrl: "https://saved-site.com",
        steps: [],
      }),
    );

    const result = await resolveArgs(
      ["--replay", "--headless"],
      prompt,
      readFileFn,
    );

    expect(result).toEqual({
      schemaUrl: "https://saved-schema.com/schema.json",
      targetUrl: "https://saved-site.com",
      resume: false,
      replay: true,
      headless: true,
    });
    expect(prompt).not.toHaveBeenCalled();
  });

  it("prompts only for values missing from the saved replay file", async () => {
    const prompt = vi.fn().mockResolvedValue("https://prompted-site.com");
    const readFileFn = vi.fn().mockResolvedValue(
      JSON.stringify({
        schemaUrl: "https://saved-schema.com/schema.json",
      }),
    );

    const result = await resolveArgs(["--replay"], prompt, readFileFn);

    expect(result).toEqual({
      schemaUrl: "https://saved-schema.com/schema.json",
      targetUrl: "https://prompted-site.com",
      resume: false,
      replay: true,
      headless: false,
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining("Target URL"));
  });

  it("prefers CLI values over saved replay values", async () => {
    const prompt = vi.fn();
    const readFileFn = vi.fn().mockResolvedValue(
      JSON.stringify({
        schemaUrl: "https://saved-schema.com/schema.json",
        targetUrl: "https://saved-site.com",
      }),
    );

    const result = await resolveArgs(
      ["--replay", "--schema", "https://cli-schema.com/schema.json"],
      prompt,
      readFileFn,
    );

    expect(result).toEqual({
      schemaUrl: "https://cli-schema.com/schema.json",
      targetUrl: "https://saved-site.com",
      resume: false,
      replay: true,
      headless: false,
    });
    expect(prompt).not.toHaveBeenCalled();
  });

  it("falls back to prompting when loading the saved file fails", async () => {
    const prompt = vi
      .fn()
      .mockResolvedValueOnce("https://prompted-schema.com/schema.json")
      .mockResolvedValueOnce("https://prompted-site.com");
    const readFileFn = vi.fn().mockRejectedValue(new Error("missing file"));

    const result = await resolveArgs(["--resume"], prompt, readFileFn);

    expect(result).toEqual({
      schemaUrl: "https://prompted-schema.com/schema.json",
      targetUrl: "https://prompted-site.com",
      resume: true,
      replay: false,
      headless: false,
    });
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it("prompts for schemaUrl when replay file has no schemaUrl but has targetUrl", async () => {
    // Covers L89 branch[2]: both parsed.schemaUrl and saved.schemaUrl are missing
    const prompt = vi.fn().mockResolvedValue("https://prompted-schema.json");
    const readFileFn = vi.fn().mockResolvedValue(
      JSON.stringify({ targetUrl: "https://saved-site.com", steps: [] }),
    );

    const result = await resolveArgs(["--replay"], prompt, readFileFn);

    expect(result?.schemaUrl).toBe("https://prompted-schema.json");
    expect(result?.targetUrl).toBe("https://saved-site.com");
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining("Schema URL"));
  });

  it("uses CLI --url over saved targetUrl in replay mode", async () => {
    // Covers L93 branch[0]: parsed.targetUrl is set
    const readFileFn = vi.fn().mockResolvedValue(
      JSON.stringify({
        schemaUrl: "https://saved-schema.json",
        targetUrl: "https://saved-site.com",
        steps: [],
      }),
    );

    const result = await resolveArgs(
      ["--replay", "--url", "https://cli-site.com"],
      undefined,
      readFileFn,
    );

    expect(result?.targetUrl).toBe("https://cli-site.com");
  });

  it("returns null in headless mode when --schema is provided but --url is missing", async () => {
    // Covers L118 branch[2]: headless=true, schemaUrl provided, targetUrl missing
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
});
