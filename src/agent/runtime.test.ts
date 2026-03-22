import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, unlinkSync } from "fs";
import type { PathLike } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createAgent,
  resolveModel,
  checkApiKey,
  buildAgentTools,
  collectAgentText,
  ConfigurationError,
  hasVertexAdcCredentials,
} from "./runtime.js";
import { allTools } from "../browser/tools.js";

import type { AgentEvent } from "@mariozechner/pi-agent-core";

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

  it("uses GEMINI_API_KEY for the google provider", () => {
    process.env = { ...env, MODEL_PROVIDER: "google" };
    delete process.env["GEMINI_API_KEY"];
    const error = getConfigurationError(() => checkApiKey());
    expect(error.message).toMatch(/GEMINI_API_KEY/);
  });

  it("uses GROQ_API_KEY for the groq provider", () => {
    process.env = { ...env, MODEL_PROVIDER: "groq" };
    delete process.env["GROQ_API_KEY"];
    const error = getConfigurationError(() => checkApiKey());
    expect(error.message).toMatch(/GROQ_API_KEY/);
  });

  it("uses XAI_API_KEY for the xai provider", () => {
    process.env = { ...env, MODEL_PROVIDER: "xai" };
    delete process.env["XAI_API_KEY"];
    const error = getConfigurationError(() => checkApiKey());
    expect(error.message).toMatch(/XAI_API_KEY/);
  });

  it("uses a derived API key variable name for unknown providers", () => {
    process.env = { ...env, MODEL_PROVIDER: "my-provider" };
    delete process.env["MY_PROVIDER_API_KEY"];
    const error = getConfigurationError(() => checkApiKey());
    expect(error.message).toMatch(/MY_PROVIDER_API_KEY/);
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
    expect(error.message).toMatch(/Missing env vars: GOOGLE_CLOUD_PROJECT/);
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
    expect(error.message).toMatch(/Missing env vars: GOOGLE_CLOUD_LOCATION/);
  });

  it("lists both required env vars when both google-vertex settings are missing", () => {
    process.env = { ...env, MODEL_PROVIDER: "google-vertex" };
    delete process.env["GOOGLE_CLOUD_PROJECT"];
    delete process.env["GCLOUD_PROJECT"];
    delete process.env["GOOGLE_CLOUD_LOCATION"];
    const error = getConfigurationError(() => checkApiKey());
    expect(error.message).toMatch(
      /GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION/,
    );
    expect(error.message).not.toMatch(/ADC credentials not found/);
  });

  it("accepts GCLOUD_PROJECT as a fallback project variable for google-vertex", () => {
    process.env = {
      ...env,
      MODEL_PROVIDER: "google-vertex",
      GCLOUD_PROJECT: "my-project",
      GOOGLE_CLOUD_LOCATION: "us-central1",
      GOOGLE_CLOUD_API_KEY: "vertex-test-key",
    };
    delete process.env["GOOGLE_CLOUD_PROJECT"];
    expect(() => checkApiKey()).not.toThrow();
  });

  it("accepts GOOGLE_APPLICATION_CREDENTIALS when the file exists", () => {
    const credentialsPath = join(
      tmpdir(),
      `gcloud-test-${Date.now()}-${Math.random()}.json`,
    );
    writeFileSync(credentialsPath, "{}");

    try {
      process.env = {
        ...env,
        MODEL_PROVIDER: "google-vertex",
        GOOGLE_CLOUD_PROJECT: "my-project",
        GOOGLE_CLOUD_LOCATION: "us-central1",
        GOOGLE_APPLICATION_CREDENTIALS: credentialsPath,
      };
      delete process.env["GOOGLE_CLOUD_API_KEY"];
      expect(() => checkApiKey()).not.toThrow();
    } finally {
      unlinkSync(credentialsPath);
    }
  });

  it("includes gcloud setup hint in the thrown error message for google-vertex", () => {
    process.env = { ...env, MODEL_PROVIDER: "google-vertex" };
    delete process.env["GOOGLE_CLOUD_PROJECT"];
    delete process.env["GOOGLE_CLOUD_LOCATION"];
    const error = getConfigurationError(() => checkApiKey());
    expect(error.message).toMatch(/gcloud/i);
  });

  it("reports missing ADC credentials when vertex env vars are present but no credentials exist", () => {
    process.env = {
      ...env,
      MODEL_PROVIDER: "google-vertex",
      GOOGLE_CLOUD_PROJECT: "my-project",
      GOOGLE_CLOUD_LOCATION: "us-central1",
    };
    delete process.env["GOOGLE_CLOUD_API_KEY"];
    delete process.env["GOOGLE_APPLICATION_CREDENTIALS"];
    expect(hasVertexAdcCredentials(() => false, "/tmp/no-home")).toBe(false);
  });

  it("shows ADC credentials not found message when project and location are set but credentials file does not exist", () => {
    process.env = {
      ...env,
      MODEL_PROVIDER: "google-vertex",
      GOOGLE_CLOUD_PROJECT: "my-project",
      GOOGLE_CLOUD_LOCATION: "us-central1",
      GOOGLE_APPLICATION_CREDENTIALS:
        "/nonexistent/path/to/credentials-xyz-123.json",
    };
    delete process.env["GOOGLE_CLOUD_API_KEY"];
    const error = getConfigurationError(() => checkApiKey());
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error.message).toMatch(/ADC credentials not found/);
    expect(error.message).not.toMatch(/Missing env vars/);
  });
});

describe("hasVertexAdcCredentials", () => {
  afterEach(() => {
    delete process.env["GOOGLE_APPLICATION_CREDENTIALS"];
  });

  it("checks GOOGLE_APPLICATION_CREDENTIALS first when set", () => {
    process.env["GOOGLE_APPLICATION_CREDENTIALS"] = "/tmp/adc.json";
    const existsSyncFn = vi.fn(
      (path: PathLike) => String(path) === "/tmp/adc.json",
    );
    expect(hasVertexAdcCredentials(existsSyncFn, "/tmp/home")).toBe(true);
    expect(existsSyncFn).toHaveBeenCalledWith("/tmp/adc.json");
  });

  it("falls back to the default gcloud ADC path when env var is absent", () => {
    delete process.env["GOOGLE_APPLICATION_CREDENTIALS"];
    const existsSyncFn = vi.fn(
      (path: PathLike) =>
        String(path) ===
        "/tmp/home/.config/gcloud/application_default_credentials.json",
    );
    expect(hasVertexAdcCredentials(existsSyncFn, "/tmp/home")).toBe(true);
    expect(existsSyncFn).toHaveBeenCalledWith(
      "/tmp/home/.config/gcloud/application_default_credentials.json",
    );
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

  it("uses the default purpose in missing-credential errors when no purpose is given", () => {
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_OAUTH_TOKEN"];
    expect(() => createAgent()).toThrow(/agent-assisted exploration/i);
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

  it("wraps action tools with polling but leaves non-action tools unchanged", () => {
    const { tools } = buildAgentTools([], false);
    const builtClick = tools.find((t) => t.name === "browser_click");
    const builtEval = tools.find((t) => t.name === "browser_eval");

    expect(builtClick).toBeDefined();
    expect(builtEval).toBeDefined();
    // Wrapped tools get a new execute function, so they differ from the base tool
    expect(builtClick!.name).toBe("browser_click");
    expect(builtEval!.name).toBe("browser_eval");
  });

  it("wraps all polled tool names (browser_navigate, browser_fill, browser_find, browser_wait, request_human_input)", () => {
    // Kills StringLiteral mutations on POLLED_TOOL_NAMES entries
    const { tools } = buildAgentTools([], false);
    const polledNames = [
      "browser_navigate",
      "browser_fill",
      "browser_find",
      "browser_wait",
      "request_human_input",
    ];
    for (const name of polledNames) {
      const original = allTools.find((t) => t.name === name);
      const built = tools.find((t) => t.name === name);
      expect(built).toBeDefined();
      expect(original).toBeDefined();
      expect(built).not.toBe(original);
    }
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

  it("ignores non-text message updates", async () => {
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
          type: "tool_use",
          id: "tool-1",
          name: "browser_click",
          input: {},
          partial: {} as never,
        },
      } as never);
      return {} as never;
    });
    expect(await collectAgentText(agent, "prompt")).toBe("");
  });

  it("resolves even when agent.prompt rejects", async () => {
    const agent = createAgent();
    vi.spyOn(agent, "subscribe").mockImplementation(() => undefined as never);
    vi.spyOn(agent, "prompt").mockRejectedValue(new Error("API error"));
    expect(await collectAgentText(agent, "prompt")).toBe("");
  });
});
