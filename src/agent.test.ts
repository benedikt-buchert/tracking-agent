import { describe, it, expect, afterEach } from "vitest";
import { parseArgs, resolveArgs, buildInitialPrompt, createSystemPrompt, createAgent, createConsoleHandler, resolveModel } from "./agent.js";
import { allTools } from "./tools.js";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";

// ─── parseArgs ────────────────────────────────────────────────────────────────
describe("parseArgs", () => {
  it("parses --schema and --url flags", () => {
    const result = parseArgs([
      "--schema", "https://example.com/schema.json",
      "--url", "https://mysite.com",
    ]);
    expect(result.schemaUrl).toBe("https://example.com/schema.json");
    expect(result.targetUrl).toBe("https://mysite.com");
    expect(result.help).toBe(false);
  });

  it("accepts flags in any order", () => {
    const result = parseArgs([
      "--url", "https://mysite.com",
      "--schema", "https://example.com/schema.json",
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

  it("returns help:false when no help flag", () => {
    expect(parseArgs([]).help).toBe(false);
  });
});

// ─── resolveArgs ──────────────────────────────────────────────────────────────
describe("resolveArgs", () => {
  it("returns null when --help is passed", async () => {
    const result = await resolveArgs(["--help"]);
    expect(result).toBeNull();
  });

  it("returns parsed args when both flags are provided", async () => {
    const result = await resolveArgs([
      "--schema", "https://example.com/schema.json",
      "--url", "https://mysite.com",
    ]);
    expect(result).toEqual({ schemaUrl: "https://example.com/schema.json", targetUrl: "https://mysite.com" });
  });

  it("prompts for missing --schema", async () => {
    const prompted: string[] = [];
    const prompt = async (q: string) => { prompted.push(q); return "https://prompted-schema.json"; };
    const result = await resolveArgs(["--url", "https://mysite.com"], prompt);
    expect(result?.schemaUrl).toBe("https://prompted-schema.json");
    expect(prompted).toHaveLength(1);
  });

  it("prompts for missing --url", async () => {
    const prompted: string[] = [];
    const prompt = async (q: string) => { prompted.push(q); return "https://prompted-url.com"; };
    const result = await resolveArgs(["--schema", "https://example.com/schema.json"], prompt);
    expect(result?.targetUrl).toBe("https://prompted-url.com");
    expect(prompted).toHaveLength(1);
  });

  it("prompts for both when no flags are provided", async () => {
    const answers = ["https://schema.json", "https://site.com"];
    const prompt = async () => answers.shift()!;
    const result = await resolveArgs([], prompt);
    expect(result).toEqual({ schemaUrl: "https://schema.json", targetUrl: "https://site.com" });
  });
});

// ─── buildInitialPrompt ───────────────────────────────────────────────────────
describe("buildInitialPrompt", () => {
  const schemaUrl = "https://example.com/schema.json";
  const targetUrl = "https://mysite.com";

  it("includes the schema URL", () => {
    const prompt = buildInitialPrompt(schemaUrl, targetUrl);
    expect(prompt).toContain(schemaUrl);
  });

  it("includes the target URL", () => {
    const prompt = buildInitialPrompt(schemaUrl, targetUrl);
    expect(prompt).toContain(targetUrl);
  });

  it("instructs the agent to fetch the schema first", () => {
    const prompt = buildInitialPrompt(schemaUrl, targetUrl);
    expect(prompt.toLowerCase()).toMatch(/fetch|schema/);
  });

  it("instructs the agent to validate events", () => {
    const prompt = buildInitialPrompt(schemaUrl, targetUrl);
    expect(prompt.toLowerCase()).toMatch(/validat/);
  });
});

// ─── createSystemPrompt ───────────────────────────────────────────────────────
describe("createSystemPrompt", () => {
  it("returns a non-empty string", () => {
    expect(createSystemPrompt().length).toBeGreaterThan(50);
  });

  it("mentions dataLayer", () => {
    expect(createSystemPrompt()).toContain("dataLayer");
  });

  it("mentions validation", () => {
    expect(createSystemPrompt().toLowerCase()).toMatch(/validat/);
  });

  it("mentions the schema", () => {
    expect(createSystemPrompt().toLowerCase()).toMatch(/schema/);
  });
});

// ─── resolveModel ─────────────────────────────────────────────────────────────
describe("resolveModel", () => {
  const originalProvider = process.env["MODEL_PROVIDER"];
  const originalId = process.env["MODEL_ID"];

  afterEach(() => {
    if (originalProvider === undefined) delete process.env["MODEL_PROVIDER"];
    else process.env["MODEL_PROVIDER"] = originalProvider;
    if (originalId === undefined) delete process.env["MODEL_ID"];
    else process.env["MODEL_ID"] = originalId;
  });

  it("defaults to anthropic / claude-opus-4-6", () => {
    delete process.env["MODEL_PROVIDER"];
    delete process.env["MODEL_ID"];
    const model = resolveModel();
    expect(model.provider).toBe("anthropic");
    expect(model.id).toBe("claude-opus-4-6");
  });

  it("uses MODEL_PROVIDER and MODEL_ID env vars", () => {
    process.env["MODEL_PROVIDER"] = "openai";
    process.env["MODEL_ID"] = "gpt-4o";
    const model = resolveModel();
    expect(model.provider).toBe("openai");
    expect(model.id).toBe("gpt-4o");
  });
});

// ─── createAgent ─────────────────────────────────────────────────────────────
describe("createAgent", () => {
  it("returns an Agent instance with a prompt method", () => {
    const agent = createAgent();
    expect(typeof agent.prompt).toBe("function");
  });

  it("registers all tools", () => {
    const agent = createAgent();
    const toolNames = agent.state.tools.map((t) => t.name);
    for (const tool of allTools) {
      expect(toolNames).toContain(tool.name);
    }
  });

  it("has the correct number of tools", () => {
    const agent = createAgent();
    expect(agent.state.tools).toHaveLength(allTools.length);
  });

  it("uses the model resolved from env vars", () => {
    delete process.env["MODEL_PROVIDER"];
    delete process.env["MODEL_ID"];
    const agent = createAgent();
    expect(agent.state.model.id).toBe("claude-opus-4-6");
    expect(agent.state.model.provider).toBe("anthropic");
  });

  it("has a system prompt set", () => {
    const agent = createAgent();
    expect(agent.state.systemPrompt.length).toBeGreaterThan(50);
  });
});

// ─── createConsoleHandler ─────────────────────────────────────────────────────

// Minimal stub for AssistantMessage used in events
const stubMsg: AssistantMessage = {
  role: "assistant",
  content: [],
  stopReason: "stop" as const,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  timestamp: 0,
  api: "anthropic" as never,
  provider: "anthropic",
  model: "claude-opus-4-6",
};

function makeTextDelta(delta: string): AgentEvent {
  return {
    type: "message_update",
    message: { role: "user", content: [{ type: "text", text: "" }], timestamp: 0 },
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta, partial: stubMsg },
  };
}

function makeTurnEndError(errorMessage: string): AgentEvent {
  return {
    type: "turn_end",
    message: { ...stubMsg, stopReason: "error" as const, errorMessage },
    toolResults: [],
  };
}

function makeToolStart(toolName: string): AgentEvent {
  return { type: "tool_execution_start", toolCallId: "t1", toolName, args: {} };
}

function makeAgentEnd(): AgentEvent {
  return { type: "agent_end", messages: [] };
}

describe("createConsoleHandler", () => {
  it("writes each text_delta to the out stream", () => {
    const out: string[] = [];
    const handler = createConsoleHandler((s) => out.push(s));
    handler(makeTextDelta("Hello"));
    handler(makeTextDelta(", world"));
    expect(out).toEqual(["Hello", ", world"]);
  });

  it("does NOT duplicate text across multiple deltas", () => {
    const out: string[] = [];
    const handler = createConsoleHandler((s) => out.push(s));
    handler(makeTextDelta("Hello"));
    handler(makeTextDelta("Hello"));
    // Each call writes only its own delta — no accumulated text
    expect(out.join("")).toBe("HelloHello");
    expect(out).toHaveLength(2);
  });

  it("writes tool name to err stream on tool_execution_start", () => {
    const err: string[] = [];
    const handler = createConsoleHandler(undefined, (s) => err.push(s));
    handler(makeToolStart("browser_snapshot"));
    expect(err.join("")).toContain("browser_snapshot");
  });

  it("writes a newline to out stream on agent_end", () => {
    const out: string[] = [];
    const handler = createConsoleHandler((s) => out.push(s));
    handler(makeAgentEnd());
    expect(out.join("")).toContain("\n");
  });

  it("ignores unrelated event types silently", () => {
    const out: string[] = [];
    const err: string[] = [];
    const handler = createConsoleHandler((s) => out.push(s), (s) => err.push(s));
    handler({ type: "agent_start" });
    handler({ type: "turn_start" });
    expect(out).toHaveLength(0);
    expect(err).toHaveLength(0);
  });

  it("writes API error message to err stream on turn_end with stopReason error", () => {
    const err: string[] = [];
    const handler = createConsoleHandler(undefined, (s) => err.push(s));
    handler(makeTurnEndError("400 Your credit balance is too low"));
    expect(err.join("")).toContain("400 Your credit balance is too low");
  });

  it("includes a hint to check billing on credit error", () => {
    const err: string[] = [];
    const handler = createConsoleHandler(undefined, (s) => err.push(s));
    handler(makeTurnEndError("400 Your credit balance is too low to access the Anthropic API"));
    expect(err.join("").toLowerCase()).toMatch(/billing|credit|plans/);
  });

  it("surfaces generic API errors clearly", () => {
    const err: string[] = [];
    const handler = createConsoleHandler(undefined, (s) => err.push(s));
    handler(makeTurnEndError("401 Invalid API key"));
    expect(err.join("")).toContain("401 Invalid API key");
  });
});
