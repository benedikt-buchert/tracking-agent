import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface SetupOptions {
  replayStuckAtIndex?: number;
  savedMessages?: unknown[];
  recordedToolEvents?: Array<{
    toolName: string;
    args: Record<string, unknown>;
  }>;
  rewriteText?: string;
  optimizedSteps?: Array<{
    tool: string;
    args: Record<string, unknown>;
  }> | null;
  finalAgentEvent?: Record<string, unknown>;
}

class FakeAgent {
  state = {
    tools: [] as unknown[],
    messages: [] as unknown[],
  };

  private readonly subscribers: Array<
    (event: Record<string, unknown>) => void
  > = [];

  constructor(
    private readonly promptImpl: (
      agent: FakeAgent,
      promptText: string,
    ) => Promise<void>,
  ) {}

  setTools(tools: unknown[]): void {
    this.state.tools = tools;
  }

  subscribe(fn: (event: Record<string, unknown>) => void): void {
    this.subscribers.push(fn);
  }

  replaceMessages(messages: unknown[]): void {
    this.state.messages = messages;
  }

  async prompt(promptText: string): Promise<void> {
    await this.promptImpl(this, promptText);
  }

  emit(event: Record<string, unknown>): void {
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }
}

async function setupWorkflowModule(options: SetupOptions = {}) {
  vi.resetModules();

  const loadPlaybook = vi.fn().mockResolvedValue({
    steps: [{ tool: "browser_click", args: { selector: "#buy" } }],
  });
  const replayPlaybook = vi
    .fn()
    .mockResolvedValue({ stuckAtIndex: options.replayStuckAtIndex ?? -1 });
  const savePlaybook = vi.fn().mockResolvedValue(undefined);
  const saveSession = vi.fn().mockResolvedValue(undefined);
  const extractPlaybookSteps = vi
    .fn()
    .mockReturnValue(options.optimizedSteps ?? undefined);

  const recordedToolEvents = options.recordedToolEvents ?? [];
  const agentPrompt = vi.fn(async (agent: FakeAgent, _promptText: string) => {
    if (agentPrompt.mock.calls.length > 1) {
      if (options.rewriteText) {
        agent.emit({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: options.rewriteText,
          },
          message: {},
        });
      }
      return;
    }

    for (const event of recordedToolEvents) {
      agent.emit({
        type: "tool_execution_start",
        toolName: event.toolName,
        args: event.args,
        toolCallId: "tool-1",
      });
    }
    agent.emit(
      options.finalAgentEvent ?? {
        type: "turn_end",
        message: { stopReason: "stop" },
      },
    );
  });

  vi.doMock("../browser/runner.js", () => ({
    extractPlaybookSteps,
    isActionTool: vi.fn((toolName: string) => toolName.startsWith("browser_")),
    loadPlaybook,
    replayPlaybook,
    savePlaybook,
    saveSession,
  }));

  vi.doMock("../agent/prompts.js", () => ({
    buildInitialPrompt: vi.fn().mockReturnValue("INITIAL PROMPT"),
    readPrompt: vi.fn((name: string) => `prompt:${name}`),
  }));

  const createAgentMock = vi.fn(() => new FakeAgent(agentPrompt));

  // Emit a tool event during optimization to detect if recording was incorrectly
  // left as true (mutations at L140/L209 that change `recording = false` to true)
  const collectAgentTextMock = vi.fn(
    async (agent: FakeAgent, _prompt: string) => {
      agent.emit({
        type: "tool_execution_start",
        toolName: "browser_navigate",
        args: { url: "https://opt.example.com" },
        toolCallId: "t-opt",
      });
      return options.rewriteText ?? "";
    },
  );

  vi.doMock("../agent/runtime.js", () => ({
    createAgent: createAgentMock,
    collectAgentText: collectAgentTextMock,
  }));

  vi.doMock("../agent/console-handler.js", () => ({
    createConsoleHandler: vi.fn(() => () => undefined),
  }));

  vi.doMock("./runtime.js", () => ({
    PLAYBOOK_FILE: ".tracking-agent-playbook.json",
    SESSION_FILE: ".tracking-agent-session.json",
  }));

  const module = await import("./agent-workflows.js");

  return {
    ...module,
    mocks: {
      loadPlaybook,
      replayPlaybook,
      savePlaybook,
      saveSession,
      extractPlaybookSteps,
      agentPrompt,
      createAgent: createAgentMock,
      collectAgentText: collectAgentTextMock,
    },
  };
}

describe("agent workflows", () => {
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderr.mockRestore();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("completes deterministic replay without saving a new playbook", async () => {
    const { runReplayMode, mocks } = await setupWorkflowModule({
      replayStuckAtIndex: -1,
    });

    await runReplayMode(
      "https://example.com/schema.json",
      "https://example.com",
      [
        {
          eventName: "purchase",
          schemaUrl: "https://example.com/purchase.json",
        },
      ],
      [{ name: "browser_click", execute: vi.fn() }] as never,
    );

    expect(mocks.loadPlaybook).toHaveBeenCalledTimes(1);
    expect(mocks.replayPlaybook).toHaveBeenCalledTimes(1);
    expect(mocks.agentPrompt).not.toHaveBeenCalled();
    expect(mocks.savePlaybook).not.toHaveBeenCalled();
    const stderrText = stderr.mock.calls
      .map(([text]: [unknown]) => String(text))
      .join("");
    expect(stderrText).toContain("skipping agent");
    expect(stderrText).toContain("Loading playbook");
    expect(stderrText).toContain(".tracking-agent-playbook.json");
    expect(stderrText).toContain("Replaying 1 step(s)");
  });

  it("falls back to the agent in replay mode and saves the optimized playbook", async () => {
    const optimizedSteps = [
      { tool: "browser_click", args: { selector: "#optimized" } },
    ];
    const { runReplayMode, mocks } = await setupWorkflowModule({
      replayStuckAtIndex: 0,
      recordedToolEvents: [
        { toolName: "browser_click", args: { selector: "#recover" } },
      ],
      rewriteText: "optimized rewrite",
      optimizedSteps,
    });

    await runReplayMode(
      "https://example.com/schema.json",
      "https://example.com",
      [
        {
          eventName: "purchase",
          schemaUrl: "https://example.com/purchase.json",
        },
      ],
      [
        {
          name: "browser_click",
          execute: vi.fn().mockResolvedValue({ content: [{ text: "ok" }] }),
        },
      ] as never,
    );

    expect(mocks.agentPrompt).toHaveBeenCalledTimes(1);
    expect(mocks.agentPrompt.mock.calls[0]?.[1]).toContain(
      "Replay got stuck at step 0",
    );
    expect(mocks.extractPlaybookSteps).toHaveBeenCalledWith(
      "optimized rewrite",
    );
    expect(mocks.savePlaybook).toHaveBeenCalledWith(
      ".tracking-agent-playbook.json",
      {
        schemaUrl: "https://example.com/schema.json",
        targetUrl: "https://example.com",
        steps: optimizedSteps,
      },
    );
    const stderrFallback = stderr.mock.calls
      .map(([text]: [unknown]) => String(text))
      .join("");
    expect(stderrFallback).toContain("Falling back to agent");
    expect(stderrFallback).toContain("optimized");
    expect(stderrFallback).toContain("optimize");
  });

  it("does not save a playbook when replay recovery records no new steps", async () => {
    const { runReplayMode, mocks } = await setupWorkflowModule({
      replayStuckAtIndex: 0,
      recordedToolEvents: [],
    });

    await runReplayMode(
      "https://example.com/schema.json",
      "https://example.com",
      [
        {
          eventName: "purchase",
          schemaUrl: "https://example.com/purchase.json",
        },
      ],
      [
        {
          name: "browser_click",
          execute: vi.fn().mockResolvedValue({ content: [{ text: "ok" }] }),
        },
      ] as never,
    );

    expect(mocks.agentPrompt).toHaveBeenCalledTimes(1);
    expect(mocks.savePlaybook).not.toHaveBeenCalled();
  });

  it("saves combined replay and recovery steps when optimization parsing fails", async () => {
    const { runReplayMode, mocks } = await setupWorkflowModule({
      replayStuckAtIndex: 0,
      recordedToolEvents: [
        { toolName: "browser_click", args: { selector: "#recover" } },
      ],
      rewriteText: "not valid json",
      optimizedSteps: null,
    });

    await runReplayMode(
      "https://example.com/schema.json",
      "https://example.com",
      [
        {
          eventName: "purchase",
          schemaUrl: "https://example.com/purchase.json",
        },
      ],
      [
        {
          name: "browser_click",
          execute: vi.fn().mockResolvedValue({ content: [{ text: "ok" }] }),
        },
      ] as never,
    );

    expect(mocks.savePlaybook).toHaveBeenCalledWith(
      ".tracking-agent-playbook.json",
      {
        schemaUrl: "https://example.com/schema.json",
        targetUrl: "https://example.com",
        steps: [{ tool: "browser_click", args: { selector: "#recover" } }],
      },
    );
    expect(
      stderr.mock.calls.map(([text]: [unknown]) => String(text)).join(""),
    ).toContain("combined");
  });

  it("records interactive steps and saves an optimized playbook", async () => {
    const optimizedSteps = [
      { tool: "browser_click", args: { selector: "#optimized" } },
    ];
    const { runInteractiveMode, mocks } = await setupWorkflowModule({
      recordedToolEvents: [
        { toolName: "browser_click", args: { selector: "#buy" } },
      ],
      rewriteText: "optimized rewrite",
      optimizedSteps,
    });

    await runInteractiveMode(
      "https://example.com/schema.json",
      "https://example.com",
      [
        {
          eventName: "purchase",
          schemaUrl: "https://example.com/purchase.json",
        },
      ],
      [],
      false,
      [{ name: "browser_click", execute: vi.fn() }] as never,
    );

    expect(mocks.agentPrompt).toHaveBeenCalledTimes(1);
    expect(mocks.saveSession).toHaveBeenCalled();
    expect(mocks.agentPrompt.mock.calls[0]?.[1]).toBe("INITIAL PROMPT");
    expect(mocks.savePlaybook).toHaveBeenCalledWith(
      ".tracking-agent-playbook.json",
      {
        schemaUrl: "https://example.com/schema.json",
        targetUrl: "https://example.com",
        steps: optimizedSteps,
      },
    );
    const stderrInteractive = stderr.mock.calls
      .map(([text]: [unknown]) => String(text))
      .join("");
    expect(stderrInteractive).toContain("optimized");
    expect(stderrInteractive).toContain("optimize");
  });

  it("does not save a playbook for fresh runs when no action steps were recorded", async () => {
    const { runInteractiveMode, mocks } = await setupWorkflowModule({
      recordedToolEvents: [],
    });

    await runInteractiveMode(
      "https://example.com/schema.json",
      "https://example.com",
      [
        {
          eventName: "purchase",
          schemaUrl: "https://example.com/purchase.json",
        },
      ],
      [],
      false,
      [{ name: "browser_click", execute: vi.fn() }] as never,
    );

    expect(mocks.savePlaybook).not.toHaveBeenCalled();
  });

  it("does not save a session when the agent emits no turn_end event", async () => {
    const { runInteractiveMode, mocks } = await setupWorkflowModule({
      finalAgentEvent: { type: "message_update", assistantMessageEvent: {} },
    });

    await runInteractiveMode(
      "https://example.com/schema.json",
      "https://example.com",
      [
        {
          eventName: "purchase",
          schemaUrl: "https://example.com/purchase.json",
        },
      ],
      [],
      false,
      [{ name: "browser_click", execute: vi.fn() }] as never,
    );

    expect(mocks.saveSession).not.toHaveBeenCalled();
  });

  it("saves raw recorded steps when optimization parsing fails in interactive mode", async () => {
    const { runInteractiveMode, mocks } = await setupWorkflowModule({
      recordedToolEvents: [
        { toolName: "browser_click", args: { selector: "#buy" } },
      ],
      rewriteText: "not valid json",
      optimizedSteps: null,
    });

    await runInteractiveMode(
      "https://example.com/schema.json",
      "https://example.com",
      [
        {
          eventName: "purchase",
          schemaUrl: "https://example.com/purchase.json",
        },
      ],
      [],
      false,
      [{ name: "browser_click", execute: vi.fn() }] as never,
    );

    expect(mocks.savePlaybook).toHaveBeenCalledWith(
      ".tracking-agent-playbook.json",
      {
        schemaUrl: "https://example.com/schema.json",
        targetUrl: "https://example.com",
        steps: [{ tool: "browser_click", args: { selector: "#buy" } }],
      },
    );
    expect(
      stderr.mock.calls.map(([text]: [unknown]) => String(text)).join(""),
    ).toContain("raw");
  });

  it("runs a fresh interactive session when resume=true but savedMessages is empty", async () => {
    const { runInteractiveMode, mocks } = await setupWorkflowModule({});

    await runInteractiveMode(
      "https://example.com/schema.json",
      "https://example.com",
      [],
      [], // empty — no saved messages
      true, // resume flag is set
      [{ name: "browser_click", execute: vi.fn() }] as never,
    );

    expect(mocks.agentPrompt).toHaveBeenCalledTimes(1);
    expect(mocks.agentPrompt.mock.calls[0]?.[1]).toBe("INITIAL PROMPT");
  });

  it("resumes an existing session without saving a new playbook", async () => {
    const savedMessages = [{ role: "assistant", content: [] }];
    const { runInteractiveMode, mocks } = await setupWorkflowModule({
      savedMessages,
    });

    await runInteractiveMode(
      "https://example.com/schema.json",
      "https://example.com",
      [
        {
          eventName: "purchase",
          schemaUrl: "https://example.com/purchase.json",
        },
      ],
      savedMessages,
      true,
      [{ name: "browser_click", execute: vi.fn() }] as never,
    );

    expect(mocks.agentPrompt).toHaveBeenCalledTimes(1);
    expect(mocks.savePlaybook).not.toHaveBeenCalled();
    const resumePrompt = mocks.agentPrompt.mock.calls[0]?.[1] as string;
    expect(resumePrompt).toContain("Continue exploring");
    expect(resumePrompt).toContain("re-opened at");
    expect(resumePrompt).toContain("You are resuming");
  });

  it("passes replay-recovery purpose to createAgent when replay gets stuck", async () => {
    const { runReplayMode, mocks } = await setupWorkflowModule({
      replayStuckAtIndex: 0,
      recordedToolEvents: [
        { toolName: "browser_click", args: { selector: "#recover" } },
      ],
    });

    await runReplayMode(
      "https://example.com/schema.json",
      "https://example.com",
      [],
      [{ name: "browser_click", execute: vi.fn() }] as never,
    );

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.stringContaining("replay recovery"),
    );
  });

  it("includes 'browser is currently open' in the stuck-replay fallback prompt", async () => {
    const { runReplayMode, mocks } = await setupWorkflowModule({
      replayStuckAtIndex: 0,
      recordedToolEvents: [
        { toolName: "browser_click", args: { selector: "#recover" } },
      ],
    });

    await runReplayMode(
      "https://example.com/schema.json",
      "https://example.com",
      [],
      [{ name: "browser_click", execute: vi.fn() }] as never,
    );

    const fallbackPrompt = mocks.agentPrompt.mock.calls[0]?.[1] as string;
    expect(fallbackPrompt).toContain("browser is currently open");
  });

  it("passes exploring purpose to createAgent in fresh interactive mode", async () => {
    const { runInteractiveMode, mocks } = await setupWorkflowModule({});

    await runInteractiveMode(
      "https://example.com/schema.json",
      "https://example.com",
      [],
      [],
      false,
      [{ name: "browser_click", execute: vi.fn() }] as never,
    );

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.stringContaining("exploring"),
    );
  });

  it("passes resuming purpose to createAgent when resume=true", async () => {
    const savedMessages = [{ role: "assistant", content: [] }];
    const { runInteractiveMode, mocks } = await setupWorkflowModule({
      savedMessages,
    });

    await runInteractiveMode(
      "https://example.com/schema.json",
      "https://example.com",
      [],
      savedMessages,
      true,
      [{ name: "browser_click", execute: vi.fn() }] as never,
    );

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.stringContaining("resuming"),
    );
  });

  it("replay optimize message includes 'optimize updated playbook' in stderr", async () => {
    const { runReplayMode } = await setupWorkflowModule({
      replayStuckAtIndex: 0,
      recordedToolEvents: [
        { toolName: "browser_click", args: { selector: "#recover" } },
      ],
      rewriteText: "optimized rewrite",
    });

    await runReplayMode(
      "https://example.com/schema.json",
      "https://example.com",
      [],
      [{ name: "browser_click", execute: vi.fn() }] as never,
    );

    const stderrText = stderr.mock.calls
      .map(([text]: [unknown]) => String(text))
      .join("");
    expect(stderrText).toContain("optimize updated playbook");
  });

  it("collectAgentText receives replay recovery context including stuck step and combined steps", async () => {
    const { runReplayMode, mocks } = await setupWorkflowModule({
      replayStuckAtIndex: 0,
      recordedToolEvents: [
        { toolName: "browser_click", args: { selector: "#recover" } },
      ],
    });

    await runReplayMode(
      "https://example.com/schema.json",
      "https://example.com",
      [],
      [{ name: "browser_click", execute: vi.fn() }] as never,
    );

    const prompt = mocks.collectAgentText.mock.calls[0]?.[1] as string;
    expect(prompt).toContain("replay broke at step 0");
    expect(prompt).toContain("combined steps");
    expect(prompt).toContain('"selector": "#recover"');
    expect(prompt).toContain("prompt:rewrite-playbook.md");
  });

  it("collectAgentText receives the rewrite-playbook prompt in interactive optimization", async () => {
    const { runInteractiveMode, mocks } = await setupWorkflowModule({
      recordedToolEvents: [
        { toolName: "browser_click", args: { selector: "#buy" } },
      ],
    });

    await runInteractiveMode(
      "https://example.com/schema.json",
      "https://example.com",
      [],
      [],
      false,
      [{ name: "browser_click", execute: vi.fn() }] as never,
    );

    const prompt = mocks.collectAgentText.mock.calls[0]?.[1] as string;
    expect(prompt).toBe("prompt:rewrite-playbook.md");
  });

  // ─── makeStepExecutor (via replayPlaybook executor argument) ─────────────────

  it("step executor calls the matching tool with replay id and returns its text", async () => {
    const mockExecute = vi
      .fn()
      .mockResolvedValue({ content: [{ text: "clicked!" }] });
    const { runReplayMode, mocks } = await setupWorkflowModule({
      replayStuckAtIndex: -1,
    });

    await runReplayMode(
      "https://example.com/schema.json",
      "https://example.com",
      [],
      [{ name: "browser_click", execute: mockExecute }] as never,
    );

    const executor = mocks.replayPlaybook.mock.calls[0]?.[1] as (step: {
      tool: string;
      args: Record<string, unknown>;
    }) => Promise<string>;
    const result = await executor({
      tool: "browser_click",
      args: { selector: "#buy" },
    });

    expect(mockExecute).toHaveBeenCalledWith("replay", { selector: "#buy" });
    expect(result).toBe("clicked!");
  });

  it("step executor returns an error message for an unknown tool", async () => {
    const { runReplayMode, mocks } = await setupWorkflowModule({
      replayStuckAtIndex: -1,
    });

    await runReplayMode("https://example.com/schema.json", "https://example.com", [], [] as never);

    const executor = mocks.replayPlaybook.mock.calls[0]?.[1] as (step: {
      tool: string;
      args: Record<string, unknown>;
    }) => Promise<string>;
    const result = await executor({ tool: "browser_unknown", args: {} });

    expect(result).toBe("Error: unknown tool browser_unknown");
  });

  it("step executor returns empty string when tool result content has no text", async () => {
    const mockExecute = vi
      .fn()
      .mockResolvedValue({ content: [{ type: "image" }] });
    const { runReplayMode, mocks } = await setupWorkflowModule({
      replayStuckAtIndex: -1,
    });

    await runReplayMode(
      "https://example.com/schema.json",
      "https://example.com",
      [],
      [{ name: "browser_screenshot", execute: mockExecute }] as never,
    );

    const executor = mocks.replayPlaybook.mock.calls[0]?.[1] as (step: {
      tool: string;
      args: Record<string, unknown>;
    }) => Promise<string>;
    const result = await executor({
      tool: "browser_screenshot",
      args: {},
    });

    expect(result).toBe("");
  });
});
