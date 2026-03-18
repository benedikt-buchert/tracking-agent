import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  parseArgs,
  resolveArgs,
  buildInitialPrompt,
  createSystemPrompt,
  createAgent,
  createConsoleHandler,
  resolveModel,
  checkApiKey,
  buildAgentTools,
  collectAgentText,
  ConfigurationError,
} from "./agent.js";
import { allTools } from "./tools.js";

import type { EventSchema } from "./schema.js";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";

// ─── parseArgs ────────────────────────────────────────────────────────────────
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
});

// ─── resolveArgs ──────────────────────────────────────────────────────────────
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
    const prompted: string[] = [];
    const prompt = async (q: string) => {
      prompted.push(q);
      return "https://prompted-schema.json";
    };
    const result = await resolveArgs(["--url", "https://mysite.com"], prompt);
    expect(result?.schemaUrl).toBe("https://prompted-schema.json");
    expect(prompted).toHaveLength(1);
  });

  it("prompts for missing --url", async () => {
    const prompted: string[] = [];
    const prompt = async (q: string) => {
      prompted.push(q);
      return "https://prompted-url.com";
    };
    const result = await resolveArgs(
      ["--schema", "https://example.com/schema.json"],
      prompt,
    );
    expect(result?.targetUrl).toBe("https://prompted-url.com");
    expect(prompted).toHaveLength(1);
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
});

// ─── buildInitialPrompt ───────────────────────────────────────────────────────
describe("buildInitialPrompt", () => {
  const schemaUrl = "https://example.com/schema.json";
  const targetUrl = "https://mysite.com";
  const eventSchemas: EventSchema[] = [
    {
      eventName: "purchase",
      schemaUrl: "https://example.com/schemas/web/purchase.json",
    },
    {
      eventName: "add_to_cart",
      schemaUrl: "https://example.com/schemas/web/add-to-cart.json",
    },
  ];

  it("includes the target URL", () => {
    const prompt = buildInitialPrompt(schemaUrl, targetUrl, eventSchemas);
    expect(prompt).toContain(targetUrl);
  });

  it("instructs the agent to validate events", () => {
    const prompt = buildInitialPrompt(schemaUrl, targetUrl, eventSchemas);
    expect(prompt.toLowerCase()).toMatch(/validat/);
  });

  it("embeds each event name in the prompt", () => {
    const prompt = buildInitialPrompt(schemaUrl, targetUrl, eventSchemas);
    expect(prompt).toContain("purchase");
    expect(prompt).toContain("add_to_cart");
  });

  it("embeds each sub-schema URL in the prompt", () => {
    const prompt = buildInitialPrompt(schemaUrl, targetUrl, eventSchemas);
    expect(prompt).toContain("https://example.com/schemas/web/purchase.json");
    expect(prompt).toContain(
      "https://example.com/schemas/web/add-to-cart.json",
    );
  });

  it("does NOT instruct the agent to fetch or discover schemas", () => {
    const prompt = buildInitialPrompt(schemaUrl, targetUrl, eventSchemas);
    // Schema discovery is done in code — the agent should not be asked to do it
    expect(prompt.toLowerCase()).not.toMatch(
      /fetch.*schema|discover.*schema|\$ref/,
    );
  });

  it("includes the description when present so the agent knows where the event fires", () => {
    const schemas: EventSchema[] = [
      {
        eventName: "purchase",
        schemaUrl: "https://example.com/schemas/web/purchase.json",
        description: "Fires when a user completes a purchase.",
      },
    ];
    const prompt = buildInitialPrompt(schemaUrl, targetUrl, schemas);
    expect(prompt).toContain("Fires when a user completes a purchase.");
  });

  it("omits the description marker when description is absent", () => {
    const schemas: EventSchema[] = [
      {
        eventName: "purchase",
        schemaUrl: "https://example.com/schemas/web/purchase.json",
      },
    ];
    const prompt = buildInitialPrompt(schemaUrl, targetUrl, schemas);
    expect(prompt).not.toContain(" — undefined");
    expect(prompt).not.toContain(" — \n");
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

  it("does not instruct the agent to call validate_event — validation is done in code", () => {
    expect(createSystemPrompt()).not.toContain("validate_event");
  });
});

// ─── checkApiKey ──────────────────────────────────────────────────────────────
describe("checkApiKey", () => {
  const env = process.env;

  function getConfigurationError(fn: () => void): ConfigurationError {
    try {
      fn();
    } catch (error) {
      return error as ConfigurationError;
    }
    throw new Error("Expected ConfigurationError to be thrown");
  }

  beforeEach(() => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  it("does not throw when ANTHROPIC_API_KEY is set for anthropic provider", () => {
    process.env = {
      ...env,
      MODEL_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-test",
    };
    expect(() => checkApiKey()).not.toThrow();
  });

  it("throws ConfigurationError when ANTHROPIC_API_KEY is missing for anthropic provider", () => {
    process.env = { ...env, MODEL_PROVIDER: "anthropic" };
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_OAUTH_TOKEN"];
    const error = getConfigurationError(() => checkApiKey());
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error.message).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("does not throw when OPENAI_API_KEY is set for openai provider", () => {
    process.env = {
      ...env,
      MODEL_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test",
    };
    expect(() => checkApiKey()).not.toThrow();
  });

  it("throws ConfigurationError when OPENAI_API_KEY is missing for openai provider", () => {
    process.env = { ...env, MODEL_PROVIDER: "openai" };
    delete process.env["OPENAI_API_KEY"];
    const error = getConfigurationError(() => checkApiKey());
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error.message).toMatch(/OPENAI_API_KEY/);
  });

  it("does not throw for google-vertex when GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION, and ADC credentials are present", () => {
    process.env = {
      ...env,
      MODEL_PROVIDER: "google-vertex",
      GOOGLE_CLOUD_PROJECT: "benedikt-testproject",
      GOOGLE_CLOUD_LOCATION: "us-central1",
      GOOGLE_CLOUD_API_KEY: "vertex-test-key",
    };
    expect(() => checkApiKey()).not.toThrow();
  });

  it("throws ConfigurationError for google-vertex when GOOGLE_CLOUD_PROJECT is missing", () => {
    process.env = {
      ...env,
      MODEL_PROVIDER: "google-vertex",
      GOOGLE_CLOUD_LOCATION: "us-central1",
    };
    delete process.env["GOOGLE_CLOUD_PROJECT"];
    delete process.env["GCLOUD_PROJECT"];
    const error = getConfigurationError(() => checkApiKey());
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error.message).toMatch(/GOOGLE_CLOUD_PROJECT/);
  });

  it("throws ConfigurationError for google-vertex when GOOGLE_CLOUD_LOCATION is missing", () => {
    process.env = {
      ...env,
      MODEL_PROVIDER: "google-vertex",
      GOOGLE_CLOUD_PROJECT: "my-project",
    };
    delete process.env["GOOGLE_CLOUD_LOCATION"];
    const error = getConfigurationError(() => checkApiKey());
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error.message).toMatch(/GOOGLE_CLOUD_LOCATION/);
  });

  it("includes gcloud setup hint in the thrown error message for google-vertex", () => {
    process.env = { ...env, MODEL_PROVIDER: "google-vertex" };
    delete process.env["GOOGLE_CLOUD_PROJECT"];
    delete process.env["GOOGLE_CLOUD_LOCATION"];
    const error = getConfigurationError(() => checkApiKey());
    expect(error.message).toMatch(/gcloud/i);
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
  const env = process.env;

  beforeEach(() => {
    process.env = {
      ...env,
      MODEL_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-test",
    };
  });

  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  it("returns an Agent instance with a prompt method", () => {
    const agent = createAgent();
    expect(typeof agent.prompt).toBe("function");
  });

  it("throws ConfigurationError when agent creation is attempted without model credentials", () => {
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_OAUTH_TOKEN"];
    expect(() => createAgent()).toThrow(ConfigurationError);
  });

  it("includes the requested agent usage context in missing-credential errors", () => {
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_OAUTH_TOKEN"];
    expect(() => createAgent("replay recovery")).toThrow(/replay recovery/i);
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

  it("does not include fetch_schema — schema discovery is deterministic code", () => {
    const agent = createAgent();
    const toolNames = agent.state.tools.map((t) => t.name);
    expect(toolNames).not.toContain("fetch_schema");
  });

  it("does not include validate_event — validation is deterministic code", () => {
    const agent = createAgent();
    const toolNames = agent.state.tools.map((t) => t.name);
    expect(toolNames).not.toContain("validate_event");
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
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  timestamp: 0,
  api: "anthropic" as never,
  provider: "anthropic",
  model: "claude-opus-4-6",
};

function makeTextDelta(delta: string): AgentEvent {
  return {
    type: "message_update",
    message: {
      role: "user",
      content: [{ type: "text", text: "" }],
      timestamp: 0,
    },
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 0,
      delta,
      partial: stubMsg,
    },
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

  it("shows the URL arg for browser_navigate", () => {
    const err: string[] = [];
    const handler = createConsoleHandler(undefined, (s) => err.push(s));
    handler({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "browser_navigate",
      args: { url: "https://example.com/shop" },
    });
    expect(err.join("")).toContain("https://example.com/shop");
  });

  it("shows selector info for browser_click", () => {
    const err: string[] = [];
    const handler = createConsoleHandler(undefined, (s) => err.push(s));
    handler({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "browser_click",
      args: { selector: "#add-to-cart" },
    });
    expect(err.join("")).toContain("#add-to-cart");
  });

  it("shows from_index for get_datalayer", () => {
    const err: string[] = [];
    const handler = createConsoleHandler(undefined, (s) => err.push(s));
    handler({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "get_datalayer",
      args: { from_index: 3 },
    });
    expect(err.join("")).toContain("3");
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
    const handler = createConsoleHandler(
      (s) => out.push(s),
      (s) => err.push(s),
    );
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
    handler(
      makeTurnEndError(
        "400 Your credit balance is too low to access the Anthropic API",
      ),
    );
    expect(err.join("").toLowerCase()).toMatch(/billing|credit|plans/);
  });

  it("surfaces generic API errors clearly", () => {
    const err: string[] = [];
    const handler = createConsoleHandler(undefined, (s) => err.push(s));
    handler(makeTurnEndError("401 Invalid API key"));
    expect(err.join("")).toContain("401 Invalid API key");
  });
});

// ─── buildAgentTools ──────────────────────────────────────────────────────────

describe("buildAgentTools", () => {
  it("excludes get_datalayer — polling is now automatic", () => {
    const { tools } = buildAgentTools([], false);
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("get_datalayer");
  });

  it("returns allTools minus get_datalayer in total", () => {
    const { tools } = buildAgentTools([], false);
    expect(tools).toHaveLength(allTools.length - 1);
  });

  it("in headless mode, request_human_input resolves immediately without reading stdin", async () => {
    const { tools } = buildAgentTools([], true);
    const hitTool = tools.find((t) => t.name === "request_human_input")!;
    await expect(
      hitTool.execute("1", { message: "do something" }),
    ).resolves.toBeDefined();
  });

  it("in headed mode, request_human_input is the original tool (waits for readline)", () => {
    const { tools: headedTools } = buildAgentTools([], false);
    const { tools: headlessTools } = buildAgentTools([], true);
    const headed = headedTools.find((t) => t.name === "request_human_input")!;
    const headless = headlessTools.find(
      (t) => t.name === "request_human_input",
    )!;
    expect(headed).not.toBe(headless);
  });
});

// ─── collectAgentText ─────────────────────────────────────────────────────────

describe("collectAgentText", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = {
      ...env,
      MODEL_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-test",
    };
  });

  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  it("returns all text deltas emitted during the agent prompt", async () => {
    const agent = createAgent();
    let captured: ((e: AgentEvent) => void) | null = null;
    vi.spyOn(agent, "subscribe").mockImplementation((fn) => {
      captured = fn as (e: AgentEvent) => void;
      return undefined as never;
    });
    vi.spyOn(agent, "prompt").mockImplementation(async () => {
      captured?.({
        type: "message_update",
        message: {} as never,
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: "Hello",
          partial: {} as never,
        },
      });
      captured?.({
        type: "message_update",
        message: {} as never,
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: " world",
          partial: {} as never,
        },
      });
      return {} as never;
    });
    expect(await collectAgentText(agent, "any prompt")).toBe("Hello world");
  });

  it("returns empty string when the agent emits no text deltas", async () => {
    const agent = createAgent();
    vi.spyOn(agent, "subscribe").mockImplementation(() => undefined as never);
    vi.spyOn(agent, "prompt").mockResolvedValue({} as never);
    expect(await collectAgentText(agent, "prompt")).toBe("");
  });

  it("resolves even when agent.prompt rejects", async () => {
    const agent = createAgent();
    vi.spyOn(agent, "subscribe").mockImplementation(() => undefined as never);
    vi.spyOn(agent, "prompt").mockRejectedValue(new Error("API error"));
    expect(await collectAgentText(agent, "prompt")).toBe("");
  });
});
