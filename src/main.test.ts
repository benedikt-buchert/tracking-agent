import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function setupMainModule() {
  vi.resetModules();

  const resolveArgs = vi.fn();
  const printHelp = vi.fn();
  const discoverEventSchemas = vi.fn().mockResolvedValue([
    {
      eventName: "purchase",
      schemaUrl: "https://example.com/purchase.schema.json",
    },
  ]);
  const runStagehandCase = vi.fn().mockResolvedValue({
    accumulatedEvents: [{ event: "purchase" }],
    actionStepsTotal: 4,
    toolCallsTotal: 6,
    journeyCompleted: true,
    humanInterventionNeeded: false,
  });
  const validateAll = vi.fn().mockResolvedValue([{ valid: true, errors: [] }]);
  const generateReport = vi.fn().mockReturnValue("REPORT");
  const saveReportFolder = vi.fn().mockResolvedValue(null);
  const writeFile = vi.fn().mockResolvedValue(undefined);

  vi.doMock("./cli/args.js", () => ({ resolveArgs, parseArgs: vi.fn() }));
  vi.doMock("./cli/help.js", () => ({
    printHelp,
    buildHelpText: vi.fn().mockReturnValue("HELP"),
  }));
  vi.doMock("./schema.js", () => ({
    discoverEventSchemas,
  }));
  vi.doMock("./validation/index.js", () => ({
    defaultLoadSchema: vi.fn(),
    createLocalFirstLoader: vi.fn().mockReturnValue(vi.fn()),
  }));
  vi.doMock("./harness/stagehand-runner.js", () => ({
    runStagehandCase,
  }));
  vi.doMock("./browser/report.js", () => ({
    validateAll,
    generateReport,
    saveReportFolder,
  }));
  vi.doMock("node:fs/promises", () => ({ writeFile }));
  const loadCredentials = vi.fn().mockResolvedValue({
    get: vi.fn(),
    fieldSummary: () => [{ field: "email", available: true }],
    stagehandVariables: () => ({
      email: {
        value: "a@b.com",
        description: "Login email",
      },
    }),
  });
  const formatCredentialsSummary = vi
    .fn()
    .mockReturnValue("Available credential fields: email");
  vi.doMock("./credentials.js", () => ({
    loadCredentials,
    formatCredentialsSummary,
  }));

  const module = await import("./main.js");

  return {
    main: module.main,
    mocks: {
      resolveArgs,
      printHelp,
      discoverEventSchemas,
      runStagehandCase,
      validateAll,
      generateReport,
      saveReportFolder,
      writeFile,
      loadCredentials,
      formatCredentialsSummary,
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
    expect(mocks.runStagehandCase).not.toHaveBeenCalled();
  });

  it("passes process.argv.slice(2) to resolveArgs", async () => {
    const { main, mocks } = await setupMainModule();
    mocks.resolveArgs.mockResolvedValue(null);

    await main();

    expect(mocks.resolveArgs).toHaveBeenCalledWith(process.argv.slice(2));
  });

  it("runs the Stagehand journey and finalizes the report", async () => {
    const { main, mocks } = await setupMainModule();
    mocks.resolveArgs.mockResolvedValue({
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://example.com",
      headless: false,
    });

    await main();

    expect(mocks.discoverEventSchemas).toHaveBeenCalledWith(
      "https://example.com/schema.json",
      "web-datalayer-js",
      expect.any(Function),
    );
    expect(mocks.runStagehandCase).toHaveBeenCalledWith(
      expect.objectContaining({
        entry_url: "https://example.com",
        site_id: "example.com",
        expected_signals: expect.objectContaining({
          important_event_names_any_of: ["purchase"],
        }),
      }),
      expect.objectContaining({
        headless: false,
        onInterventionNeeded: expect.any(Function),
      }),
    );
    expect(mocks.validateAll).toHaveBeenCalledTimes(1);
    expect(mocks.generateReport).toHaveBeenCalledTimes(1);
    expect(stdout).toHaveBeenCalledWith("REPORT");
  });

  it("shows headless in the startup banner", async () => {
    const { main, mocks } = await setupMainModule();
    mocks.resolveArgs.mockResolvedValue({
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://example.com",
      headless: true,
    });

    await main();

    const stderrText = stderr.mock.calls
      .map(([text]: [unknown]) => String(text))
      .join("");
    expect(stderrText).toContain("Browser: headless");
  });

  it("shows cache dir in the startup banner when provided", async () => {
    const { main, mocks } = await setupMainModule();
    mocks.resolveArgs.mockResolvedValue({
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://example.com",
      headless: false,
      cacheDir: "agent-cache",
    });

    await main();

    const stderrText = stderr.mock.calls
      .map(([text]: [unknown]) => String(text))
      .join("");
    expect(stderrText).toContain("Cache: agent-cache");
    expect(mocks.runStagehandCase).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ cacheDir: "agent-cache" }),
    );
  });

  it("writes the saved report path when report persistence succeeds", async () => {
    const { main, mocks } = await setupMainModule();
    mocks.resolveArgs.mockResolvedValue({
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://example.com",
      headless: false,
    });
    mocks.saveReportFolder.mockResolvedValue("/tmp/report-dir");

    await main();

    expect(stderr.mock.calls.join("")).toContain("Report saved");
    expect(stderr.mock.calls.join("")).toContain("/tmp/report-dir");
  });

  it("writes capture diagnostics next to the saved report when available", async () => {
    const { main, mocks } = await setupMainModule();
    mocks.resolveArgs.mockResolvedValue({
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://example.com",
      headless: false,
    });
    mocks.runStagehandCase.mockResolvedValue({
      accumulatedEvents: [{ event: "purchase" }],
      actionStepsTotal: 4,
      toolCallsTotal: 6,
      journeyCompleted: true,
      humanInterventionNeeded: false,
      captureDiagnostics: {
        capturedEvents: [{ event: "addToCart" }],
        rawDataLayerEvents: [{ event: "addToCart" }, { event: "purchase" }],
      },
    });
    mocks.saveReportFolder.mockResolvedValue("/tmp/report-dir");

    await main();

    expect(mocks.writeFile).toHaveBeenCalledWith(
      "/tmp/report-dir/capture-diagnostics.json",
      JSON.stringify(
        {
          capturedEvents: [{ event: "addToCart" }],
          rawDataLayerEvents: [{ event: "addToCart" }, { event: "purchase" }],
        },
        null,
        2,
      ),
      "utf8",
    );
  });

  it("suppresses banner and progress output in quiet mode", async () => {
    const { main, mocks } = await setupMainModule();
    mocks.resolveArgs.mockResolvedValue({
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://example.com",
      headless: false,
      quiet: true,
      verbose: false,
    });

    await main();

    const stderrText = stderr.mock.calls
      .map(([text]: [unknown]) => String(text))
      .join("");
    expect(stderrText).not.toContain("Tracking Agent");
    expect(stderrText).not.toContain("Validating events");
  });

  it("shows verbose-only messages in verbose mode", async () => {
    const { main, mocks } = await setupMainModule();
    mocks.resolveArgs.mockResolvedValue({
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://example.com",
      headless: false,
      quiet: false,
      verbose: true,
    });

    await main();

    const stderrText = stderr.mock.calls
      .map(([text]: [unknown]) => String(text))
      .join("");
    expect(stderrText).toContain("Tracking Agent");
    expect(stderrText).toContain("Validating events");
  });

  it("includes event description in journey hint when available", async () => {
    const { main, mocks } = await setupMainModule();
    mocks.discoverEventSchemas.mockResolvedValue([
      {
        eventName: "addToCart",
        schemaUrl: "https://example.com/addToCart.schema.json",
        description: "Fired when a user adds a product to the cart after selecting a size.",
      },
    ]);
    mocks.resolveArgs.mockResolvedValue({
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://example.com",
      headless: false,
    });

    await main();

    expect(mocks.runStagehandCase).toHaveBeenCalledWith(
      expect.objectContaining({
        journey_hint: expect.stringContaining(
          "addToCart: Fired when a user adds a product to the cart after selecting a size.",
        ),
      }),
      expect.any(Object),
    );
  });

  it("loads credentials and threads them into the journey hint when available", async () => {
    const { main, mocks } = await setupMainModule();
    mocks.resolveArgs.mockResolvedValue({
      schemaUrl: "https://example.com/schema.json",
      targetUrl: "https://example.com",
      headless: false,
      credentials: "./creds.json",
    });

    await main();

    expect(mocks.loadCredentials).toHaveBeenCalledWith("./creds.json");
    expect(mocks.runStagehandCase).toHaveBeenCalledWith(
      expect.objectContaining({
        journey_hint: expect.stringContaining("Available credential fields"),
      }),
      expect.objectContaining({
        headless: false,
        variables: {
          email: {
            value: "a@b.com",
            description: "Login email",
          },
        },
        onInterventionNeeded: expect.any(Function),
      }),
    );
  });

  it("passes the configured phase timeout from env", async () => {
    const previous = process.env["STAGEHAND_PHASE_TIMEOUT_MS"];
    try {
      process.env["STAGEHAND_PHASE_TIMEOUT_MS"] = "240000";
      const { main, mocks } = await setupMainModule();
      mocks.resolveArgs.mockResolvedValue({
        schemaUrl: "https://example.com/schema.json",
        targetUrl: "https://example.com",
        headless: false,
      });

      await main();

      expect(mocks.runStagehandCase).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          headless: false,
          phaseTimeoutMs: 240000,
          onInterventionNeeded: expect.any(Function),
        }),
      );
    } finally {
      if (previous === undefined)
        delete process.env["STAGEHAND_PHASE_TIMEOUT_MS"];
      else process.env["STAGEHAND_PHASE_TIMEOUT_MS"] = previous;
    }
  });
});
