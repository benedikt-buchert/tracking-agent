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
    expect(help).toContain("--quiet");
    expect(help).toContain("--verbose");
    expect(help).toContain("--credentials");
    expect(help).toContain("STAGEHAND_MODEL");
    expect(help).toContain("STAGEHAND_PROJECT");
  });

  it("includes the Stagehand env hints", () => {
    const help = buildHelpText();
    expect(help).toContain("STAGEHAND_EXECUTION_MODEL");
    expect(help).toContain("GOOGLE_GENERATIVE_AI_API_KEY");
    expect(help).toContain("gcloud auth application-default login");
  });

  it("ends with a trailing newline", () => {
    expect(buildHelpText().endsWith("\n")).toBe(true);
  });

  it("ends with a blank line after the vertex auth hint", () => {
    expect(buildHelpText()).toMatch(/\n\n$/);
  });

  it("renders the documented usage, options, and environment lines", () => {
    expect(stripAnsi(buildHelpText())).toContain(`tracking-agent

  Validates a website's dataLayer events against a JSON Schema.

  Usage
    tracking-agent --schema <url> --url <url>

  Options
    --schema  URL of the JSON Schema to validate against
    --url     URL of the website to test
    --schemas-dir  Local directory of schema files (used instead of remote fetches)
    --credentials  Path to a JSON file with credential fields (see docs)
    --cache-dir  Directory for the action cache (default: .cache)
    --headless  Run the browser in the background (no visible window)
    --quiet     Suppress all progress output (only errors and the final report)
    --verbose   Show detailed step-by-step progress
    --help      Show this help message

  Environment
    STAGEHAND_MODEL               Primary Stagehand model (required)
    STAGEHAND_PROJECT             GCP project for Vertex models
    STAGEHAND_LOCATION            Vertex location for STAGEHAND_MODEL
    STAGEHAND_AGENT_MODEL         Hybrid agent model override
    STAGEHAND_EXECUTION_MODEL     Hybrid execution model override
    STAGEHAND_AGENT_LOCATION      Vertex location for STAGEHAND_AGENT_MODEL
    STAGEHAND_EXECUTION_LOCATION  Vertex location for STAGEHAND_EXECUTION_MODEL
    GOOGLE_GENERATIVE_AI_API_KEY  Google model API key when using google/... models
    OPENAI_API_KEY                OpenAI API key when using openai/... models
    Vertex auth: gcloud auth application-default login`);
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
