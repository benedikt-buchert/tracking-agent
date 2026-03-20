import { describe, it, expect, vi } from "vitest";
import { buildHelpText, printHelp } from "./help.js";

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*m/g, "");
}

describe("buildHelpText", () => {
  it("includes the CLI options and environment variables", () => {
    const help = buildHelpText();
    expect(help).toContain("--schema");
    expect(help).toContain("--url");
    expect(help).toContain("--headless");
    expect(help).toContain("MODEL_PROVIDER");
    expect(help).toContain("GOOGLE_CLOUD_PROJECT");
  });

  it("includes the replay fallback note and vertex auth hint", () => {
    const help = buildHelpText();
    expect(help).toContain("LLM fallback on failure");
    expect(help).toContain("gcloud auth application-default login");
  });

  it("ends with a trailing newline", () => {
    expect(buildHelpText().endsWith("\n")).toBe(true);
  });

  it("renders the documented usage, options, and environment lines", () => {
    expect(stripAnsi(buildHelpText())).toContain(`tracking-agent

  Validates a website's dataLayer events against a JSON Schema.

  Usage
    tracking-agent --schema <url> --url <url>

  Options
    --schema  URL of the JSON Schema to validate against
    --url     URL of the website to test
    --resume  Resume a previous session from .tracking-agent-session.json
    --replay    Replay recorded steps from .tracking-agent-playbook.json (LLM fallback on failure)
    --headless  Run the browser in the background (no visible window)
    --help      Show this help message

  Environment
    MODEL_PROVIDER         AI provider (default: anthropic)
    MODEL_ID               Model ID (default: claude-opus-4-6)
    ANTHROPIC_API_KEY       For anthropic provider
    OPENAI_API_KEY          For openai provider
    GOOGLE_CLOUD_PROJECT    For google-vertex provider
    GOOGLE_CLOUD_LOCATION   For google-vertex provider
    Google Vertex auth: gcloud auth application-default login`);
  });
});

describe("printHelp", () => {
  it("writes the built help text to stdout", () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    printHelp();
    expect(stdout).toHaveBeenCalledWith(buildHelpText());
  });
});
