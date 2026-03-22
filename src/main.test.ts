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
    loadSchemaFn: vi.fn(),
  });
  const openBrowser = vi.fn().mockResolvedValue(undefined);
  const mockBrowserFn = vi.fn();
  const buildAgentTools = vi.fn().mockReturnValue({ tools: [], browserFn: mockBrowserFn, sessionId: "test-session" });
  const runReplayMode = vi.fn().mockResolvedValue(undefined);
  const runInteractiveMode = vi.fn().mockResolvedValue(undefined);
  const validateAll = vi.fn().mockResolvedValue([{ valid: true, errors: [] }]);
  const generateReport = vi.fn().mockReturnValue("REPORT");
  const closeRunBrowser = vi.fn().mockResolvedValue(undefined);
  const saveReportFolder = vi.fn().mockResolvedValue(null);
  const drainInterceptor = vi.fn().mockResolvedValue([]);
  const captureFinalEvents = vi.fn().mockResolvedValue([{ event: "purchase" }]);

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
    captureFinalEvents,
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
    drainInterceptor,
    generateReport,
    saveReportFolder,
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
      saveReportFolder,
      drainInterceptor,
      captureFinalEvents,
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

  it("passes process.argv.slice(2) to resolveArgs", async () => {
    const { main, mocks } = await setupMainModule();
    mocks.resolveArgs.mockResolvedValue(null);

    await main();

    expect(mocks.resolveArgs).toHaveBeenCalledWith(process.argv.slice(2));
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
      undefined,
    );
    expect(mocks.openBrowser).toHaveBeenCalledWith(
      "https://example.com",
      false,
      expect.any(Function),
    );
    expect(mocks.runReplayMode).toHaveBeenCalledTimes(1);
    expect(mocks.runInteractiveMode).not.toHaveBeenCalled();
    expect(mocks.validateAll).toHaveBeenCalledTimes(1);
    expect(mocks.generateReport).toHaveBeenCalledTimes(1);
    expect(stdout).toHaveBeenCalledWith("REPORT");
    expect(mocks.closeRunBrowser).toHaveBeenCalledTimes(1);
    expect(mocks.captureFinalEvents).toHaveBeenCalledWith([], expect.any(Function));
    expect(mocks.saveReportFolder).toHaveBeenCalledWith(
      "tracking-reports",
      [{ event: "purchase" }],
      [{ valid: true, errors: [] }],
      ["purchase"],
      "REPORT",
    );
    const stderrText = stderr.mock.calls
      .map(([text]: [unknown]) => String(text))
      .join("");
    expect(stderrText).toContain("Tracking Agent");
    expect(stderrText).toContain("Schema:");
    expect(stderrText).toContain("Target:");
    expect(stderrText).toContain("Validating events");
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
    expect(stderr.mock.calls.join("")).toContain("Mode: resume");
    expect(stderr.mock.calls.join("")).toContain("Browser: headless");
  });

  it("prints replay mode in the startup banner", async () => {
    const { main, mocks } = await setupMainModule();
    mocks.resolveArgs.mockResolvedValue({
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://example.com",
      resume: false,
      replay: true,
      headless: false,
    });

    await main();

    expect(stderr.mock.calls.join("")).toContain("Mode: replay");
    expect(stderr.mock.calls.join("")).not.toContain("Browser: headless");
  });

  it("writes the saved report path when report persistence succeeds", async () => {
    const { main, mocks } = await setupMainModule();
    mocks.resolveArgs.mockResolvedValue({
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://example.com",
      resume: false,
      replay: false,
      headless: false,
    });
    mocks.saveReportFolder.mockResolvedValue("/tmp/report-dir");

    await main();

    expect(stderr.mock.calls.join("")).toContain("Report saved");
    expect(stderr.mock.calls.join("")).toContain("/tmp/report-dir");
  });

  it("does not show mode line in the banner for a fresh (non-replay, non-resume) run", async () => {
    const { main, mocks } = await setupMainModule();
    mocks.resolveArgs.mockResolvedValue({
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://example.com",
      resume: false,
      replay: false,
      headless: false,
    });

    await main();

    const stderrText = stderr.mock.calls
      .map(([text]: [unknown]) => String(text))
      .join("");
    expect(stderrText).not.toContain("Mode:");
    expect(stderrText).not.toContain("Browser: headless");
  });

  it("does not show report saved message when saveReportFolder returns null", async () => {
    const { main, mocks } = await setupMainModule();
    mocks.resolveArgs.mockResolvedValue({
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://example.com",
      resume: false,
      replay: false,
      headless: false,
    });
    mocks.saveReportFolder.mockResolvedValue(null);

    await main();

    expect(stderr.mock.calls.join("")).not.toContain("Report saved");
  });

  it("does not show report saved when saveReportFolder rejects", async () => {
    const { main, mocks } = await setupMainModule();
    mocks.resolveArgs.mockResolvedValue({
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://example.com",
      resume: false,
      replay: false,
      headless: false,
    });
    mocks.saveReportFolder.mockRejectedValue(new Error("disk full"));

    await main();

    expect(stderr.mock.calls.join("")).not.toContain("Report saved");
  });

  it("pushes landing events into the shared accumulator after building tools", async () => {
    const { main, mocks } = await setupMainModule();
    mocks.resolveArgs.mockResolvedValue({
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://example.com",
      resume: false,
      replay: false,
      headless: false,
    });
    mocks.drainInterceptor.mockResolvedValue([{ event: "landing" }]);

    await main();

    // buildAgentTools receives the accumulator array (by reference);
    // landing events are pushed into it after the browser opens.
    const accArg = mocks.buildAgentTools.mock.calls[0][0] as unknown[];
    expect(accArg).toContainEqual({ event: "landing" });
  });
});
