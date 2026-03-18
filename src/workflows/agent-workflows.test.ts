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
    agent.emit({ type: "turn_end", message: { stopReason: "stop" } });
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

  vi.doMock("../agent/runtime.js", () => ({
    createAgent: vi.fn(() => new FakeAgent(agentPrompt)),
    collectAgentText: vi.fn(async () => options.rewriteText ?? ""),
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
    expect(
      stderr.mock.calls.map(([text]: [unknown]) => String(text)).join(""),
    ).toContain("Falling back to agent");
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
    expect(mocks.savePlaybook).toHaveBeenCalledWith(
      ".tracking-agent-playbook.json",
      {
        schemaUrl: "https://example.com/schema.json",
        targetUrl: "https://example.com",
        steps: optimizedSteps,
      },
    );
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
  });
});
