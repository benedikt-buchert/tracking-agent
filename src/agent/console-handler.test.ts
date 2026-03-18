import { describe, it, expect, afterEach } from "vitest";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { createConsoleHandler } from "./console-handler.js";

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
  afterEach(() => {
    delete process.env["MODEL_PROVIDER"];
  });

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

  it("falls back to text for browser_click when selector is absent", () => {
    const err: string[] = [];
    const handler = createConsoleHandler(undefined, (s) => err.push(s));
    handler({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "browser_click",
      args: { text: "Checkout" },
    });
    expect(err.join("")).toContain("Checkout");
  });

  it("shows selector and value for browser_fill", () => {
    const err: string[] = [];
    const handler = createConsoleHandler(undefined, (s) => err.push(s));
    handler({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "browser_fill",
      args: { selector: "#email", value: "user@example.com" },
    });
    expect(err.join("")).toContain('#email = "user@example.com"');
  });

  it("falls back to text for browser_fill when value is absent", () => {
    const err: string[] = [];
    const handler = createConsoleHandler(undefined, (s) => err.push(s));
    handler({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "browser_fill",
      args: { selector: "#search", text: "running shoes" },
    });
    expect(err.join("")).toContain('#search = "running shoes"');
  });

  it("shows locator and value for browser_find", () => {
    const err: string[] = [];
    const handler = createConsoleHandler(undefined, (s) => err.push(s));
    handler({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "browser_find",
      args: { locator: "text", value: "Add to cart" },
    });
    expect(err.join("")).toContain('text "Add to cart"');
  });

  it("truncates browser_eval summaries to 60 characters", () => {
    const err: string[] = [];
    const handler = createConsoleHandler(undefined, (s) => err.push(s));
    const expression = "x".repeat(80);
    handler({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "browser_eval",
      args: { expression },
    });
    expect(err.join("")).toContain("x".repeat(60));
    expect(err.join("")).not.toContain("x".repeat(61));
  });

  it("shows load state for browser_wait before selector or timeout", () => {
    const err: string[] = [];
    const handler = createConsoleHandler(undefined, (s) => err.push(s));
    handler({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "browser_wait",
      args: { load: "networkidle", selector: "#ready", ms: 5000 },
    });
    expect(err.join("")).toContain("networkidle");
    expect(err.join("")).not.toContain("#ready");
  });

  it("falls back to timeout for browser_wait when no other target exists", () => {
    const err: string[] = [];
    const handler = createConsoleHandler(undefined, (s) => err.push(s));
    handler({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "browser_wait",
      args: { ms: 2500 },
    });
    expect(err.join("")).toContain("2500");
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

  it("truncates request_human_input messages to 80 characters", () => {
    const err: string[] = [];
    const handler = createConsoleHandler(undefined, (s) => err.push(s));
    const message = "a".repeat(100);
    handler({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "request_human_input",
      args: { message },
    });
    expect(err.join("")).toContain("a".repeat(80));
    expect(err.join("")).not.toContain("a".repeat(81));
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

  it("uses the OpenAI billing URL when MODEL_PROVIDER=openai", () => {
    const err: string[] = [];
    process.env["MODEL_PROVIDER"] = "openai";
    const handler = createConsoleHandler(undefined, (s) => err.push(s));
    handler(makeTurnEndError("Quota exceeded for this API key"));
    expect(err.join("")).toContain("platform.openai.com/settings/billing");
  });

  it("does not add a billing hint for generic non-billing errors", () => {
    const err: string[] = [];
    const handler = createConsoleHandler(undefined, (s) => err.push(s));
    handler(makeTurnEndError("401 Invalid API key"));
    expect(err.join("")).not.toContain("Hint: Add credits");
  });

  it("surfaces generic API errors clearly", () => {
    const err: string[] = [];
    const handler = createConsoleHandler(undefined, (s) => err.push(s));
    handler(makeTurnEndError("401 Invalid API key"));
    expect(err.join("")).toContain("401 Invalid API key");
  });
});
