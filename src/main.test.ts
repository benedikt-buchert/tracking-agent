import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function setupMainModule() {
  vi.resetModules();

  const resolveArgs = vi.fn();
  const printHelp = vi.fn();
  const loadRunState = vi.fn().mockResolvedValue({
    eventSchemas: [
      {
        eventName: "purchase",
        schemaUrl: "https://example.com/purchase.schema.json",
      },
    ],
    savedMessages: [],
  });
  const openBrowser = vi.fn().mockResolvedValue(undefined);
  const buildAgentTools = vi.fn().mockReturnValue({ tools: [] });
  const runReplayMode = vi.fn().mockResolvedValue(undefined);
  const runInteractiveMode = vi.fn().mockResolvedValue(undefined);
  const validateAll = vi.fn().mockResolvedValue([{ valid: true, errors: [] }]);
  const generateReport = vi.fn().mockReturnValue("REPORT");
  const closeRunBrowser = vi.fn().mockResolvedValue(undefined);

  vi.doMock("./cli/args.js", () => ({ resolveArgs, parseArgs: vi.fn() }));
  vi.doMock("./cli/help.js", () => ({
    printHelp,
    buildHelpText: vi.fn().mockReturnValue("HELP"),
  }));
  vi.doMock("./agent/runtime.js", () => ({
    buildAgentTools,
    checkApiKey: vi.fn(),
    collectAgentText: vi.fn(),
    ConfigurationError: class ConfigurationError extends Error {},
    createAgent: vi.fn(),
    resolveModel: vi.fn(),
  }));
  vi.doMock("./agent/prompts.js", () => ({
    buildInitialPrompt: vi.fn(),
    createSystemPrompt: vi.fn(),
    readPrompt: vi.fn(),
  }));
  vi.doMock("./agent/console-handler.js", () => ({
    createConsoleHandler: vi.fn(),
  }));
  vi.doMock("./workflows/runtime.js", () => ({
    captureFinalEvents: vi.fn().mockResolvedValue([{ event: "purchase" }]),
    closeRunBrowser,
    loadRunState,
    openBrowser,
    PLAYBOOK_FILE: ".tracking-agent-playbook.json",
    SESSION_FILE: ".tracking-agent-session.json",
  }));
  vi.doMock("./workflows/agent-workflows.js", () => ({
    runReplayMode,
    runInteractiveMode,
  }));
  vi.doMock("./browser/runner.js", () => ({
    drainInterceptor: vi.fn().mockResolvedValue([]),
    generateReport,
    saveReportFolder: vi.fn().mockResolvedValue(null),
    validateAll,
  }));
  vi.doMock("./browser/tools.js", () => ({ allTools: [] }));

  const module = await import("./main.js");

  return {
    main: module.main,
    mocks: {
      resolveArgs,
      printHelp,
      loadRunState,
      openBrowser,
      buildAgentTools,
      runReplayMode,
      runInteractiveMode,
      validateAll,
      generateReport,
      closeRunBrowser,
    },
  };
}

describe("main composition", () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("prints help and returns when args are unavailable", async () => {
    const { main, mocks } = await setupMainModule();
    mocks.resolveArgs.mockResolvedValue(null);

    await main();

    expect(mocks.printHelp).toHaveBeenCalledTimes(1);
    expect(mocks.runReplayMode).not.toHaveBeenCalled();
    expect(mocks.runInteractiveMode).not.toHaveBeenCalled();
  });

  it("delegates replay runs to the replay workflow and finalizes the report", async () => {
    const { main, mocks } = await setupMainModule();
    mocks.resolveArgs.mockResolvedValue({
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://example.com",
      resume: false,
      replay: true,
      headless: false,
    });

    await main();

    expect(mocks.loadRunState).toHaveBeenCalledWith(
      "https://example.com/schema.json",
      false,
    );
    expect(mocks.openBrowser).toHaveBeenCalledWith(
      "https://example.com",
      false,
    );
    expect(mocks.runReplayMode).toHaveBeenCalledTimes(1);
    expect(mocks.runInteractiveMode).not.toHaveBeenCalled();
    expect(mocks.validateAll).toHaveBeenCalledTimes(1);
    expect(mocks.generateReport).toHaveBeenCalledTimes(1);
    expect(stdout).toHaveBeenCalledWith("REPORT");
    expect(mocks.closeRunBrowser).toHaveBeenCalledTimes(1);
  });

  it("delegates non-replay runs to the interactive workflow", async () => {
    const { main, mocks } = await setupMainModule();
    mocks.resolveArgs.mockResolvedValue({
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://example.com",
      resume: true,
      replay: false,
      headless: true,
    });
    mocks.loadRunState.mockResolvedValue({
      eventSchemas: [
        {
          eventName: "purchase",
          schemaUrl: "https://example.com/purchase.schema.json",
        },
      ],
      savedMessages: [{ role: "assistant", content: [] }],
    });

    await main();

    expect(mocks.runInteractiveMode).toHaveBeenCalledTimes(1);
    expect(mocks.runReplayMode).not.toHaveBeenCalled();
  });
});
