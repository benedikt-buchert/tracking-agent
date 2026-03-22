import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function setupRuntimeModule() {
  vi.resetModules();

  const discoverEventSchemas = vi.fn().mockResolvedValue([
    {
      eventName: "purchase",
      schemaUrl: "https://example.com/purchase.schema.json",
    },
  ]);
  const closeBrowser = vi.fn().mockResolvedValue(undefined);
  const drainInterceptor = vi
    .fn()
    .mockResolvedValueOnce([{ event: "pre" }])
    .mockResolvedValueOnce([{ event: "post" }]);
  const getCurrentUrl = vi.fn().mockResolvedValue("https://example.com/next");
  const loadSession = vi.fn().mockResolvedValue({
    eventSchemas: [
      {
        eventName: "purchase",
        schemaUrl: "https://example.com/purchase.schema.json",
      },
    ],
    messages: [{ role: "assistant", content: [] }],
  });
  const navigateTo = vi.fn().mockResolvedValue(undefined);
  const startHeadedBrowser = vi.fn().mockResolvedValue(undefined);
  const waitForNavigation = vi.fn().mockResolvedValue(undefined);

  vi.doMock("../schema.js", () => ({
    discoverEventSchemas,
  }));
  const defaultBrowserFn = vi.fn();
  vi.doMock("../browser/runner.js", () => ({
    closeBrowser,
    defaultBrowserFn,
    drainInterceptor,
    getCurrentUrl,
    loadSession,
    navigateTo,
    startHeadedBrowser,
    waitForNavigation,
  }));

  const module = await import("./runtime.js");

  return {
    ...module,
    mocks: {
      discoverEventSchemas,
      closeBrowser,
      drainInterceptor,
      getCurrentUrl,
      loadSession,
      navigateTo,
      startHeadedBrowser,
      waitForNavigation,
    },
  };
}

describe("workflow runtime", () => {
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderr.mockRestore();
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env["AGENT_BROWSER_HEADED"];
  });

  it("loads session state when resuming", async () => {
    const { loadRunState, mocks } = await setupRuntimeModule();

    const result = await loadRunState("https://example.com/schema.json", true);

    expect(mocks.loadSession).toHaveBeenCalledWith(
      ".tracking-agent-session.json",
    );
    expect(mocks.discoverEventSchemas).not.toHaveBeenCalled();
    expect(result.savedMessages).toEqual([{ role: "assistant", content: [] }]);
    expect(stderr.mock.calls.join("")).toContain("Loading session");
    expect(stderr.mock.calls.join("")).toContain(
      "Restored 1 schema(s), 1 messages",
    );
  });

  it("returns foundEventNames from session when resuming", async () => {
    const { loadRunState, mocks } = await setupRuntimeModule();
    mocks.loadSession.mockResolvedValueOnce({
      eventSchemas: [{ eventName: "purchase", schemaUrl: "https://example.com/purchase.json" }],
      messages: [],
      foundEventNames: ["purchase"],
    });

    const result = await loadRunState("https://example.com/schema.json", true);

    expect(result.foundEventNames).toEqual(["purchase"]);
  });

  it("returns empty foundEventNames when session has none (backwards compat)", async () => {
    const { loadRunState } = await setupRuntimeModule();
    // default mock has no foundEventNames field
    const result = await loadRunState("https://example.com/schema.json", true);
    expect(result.foundEventNames).toEqual([]);
  });

  it("returns empty foundEventNames when not resuming", async () => {
    const { loadRunState } = await setupRuntimeModule();
    const result = await loadRunState("https://example.com/schema.json", false);
    expect(result.foundEventNames).toEqual([]);
  });

  it("discovers schemas when not resuming", async () => {
    const { loadRunState, mocks } = await setupRuntimeModule();

    const result = await loadRunState("https://example.com/schema.json", false);

    expect(mocks.discoverEventSchemas).toHaveBeenCalledWith(
      "https://example.com/schema.json",
      "web-datalayer-js",
      expect.any(Function),
    );
    expect(result.eventSchemas).toHaveLength(1);
    expect(result.savedMessages).toEqual([]);
    expect(result.loadSchemaFn).toBeTypeOf("function");
    expect(stderr.mock.calls.join("")).toContain(
      "Discovering schemas from https://example.com/schema.json",
    );
    expect(stderr.mock.calls.join("")).toContain("Found 1 event schema(s)");
  });

  it("uses a local-first loader when schemasDir is provided", async () => {
    vi.resetModules();

    const localFirstFn = vi.fn();
    const createLocalFirstLoader = vi.fn().mockReturnValue(localFirstFn);
    const defaultLoadSchema = vi.fn();
    const discoverEventSchemas = vi.fn().mockResolvedValue([]);

    vi.doMock("../validation/index.js", () => ({
      createLocalFirstLoader,
      defaultLoadSchema,
    }));
    vi.doMock("../schema.js", () => ({ discoverEventSchemas }));
    vi.doMock("../browser/runner.js", () => ({
      closeBrowser: vi.fn(),
      drainInterceptor: vi.fn().mockResolvedValue([]),
      getCurrentUrl: vi.fn().mockResolvedValue(""),
      loadSession: vi.fn(),
      navigateTo: vi.fn(),
      startHeadedBrowser: vi.fn(),
      waitForNavigation: vi.fn(),
    }));

    const { loadRunState } = await import("./runtime.js");

    const result = await loadRunState(
      "https://example.com/schema.json",
      false,
      "/tmp/local-schemas",
    );

    expect(createLocalFirstLoader).toHaveBeenCalledWith("/tmp/local-schemas");
    expect(defaultLoadSchema).not.toHaveBeenCalled();
    expect(discoverEventSchemas).toHaveBeenCalledWith(
      "https://example.com/schema.json",
      "web-datalayer-js",
      localFirstFn,
    );
    expect(result.loadSchemaFn).toBe(localFirstFn);
  });

  it("starts headed browser when headless is false", async () => {
    const { openBrowser, mocks } = await setupRuntimeModule();

    await openBrowser("https://example.com", false);

    expect(mocks.startHeadedBrowser).toHaveBeenCalledTimes(1);
    expect(mocks.navigateTo).toHaveBeenCalledWith("https://example.com", expect.any(Function));
    expect(stderr.mock.calls.join("")).toContain("Starting headed browser");
    expect(stderr.mock.calls.join("")).toContain("Opening https://example.com");
  });

  it("skips headed startup and clears AGENT_BROWSER_HEADED in headless mode", async () => {
    process.env["AGENT_BROWSER_HEADED"] = "1";
    const { openBrowser, mocks } = await setupRuntimeModule();

    await openBrowser("https://example.com", true);

    expect(mocks.startHeadedBrowser).not.toHaveBeenCalled();
    expect(process.env["AGENT_BROWSER_HEADED"]).toBeUndefined();
    expect(mocks.navigateTo).toHaveBeenCalledWith("https://example.com", expect.any(Function));
    expect(stderr.mock.calls.join("")).toContain("Starting headless browser");
  });

  it("captures pre- and post-navigation events", async () => {
    const { captureFinalEvents, mocks } = await setupRuntimeModule();
    const events = [{ event: "existing" }];

    const result = await captureFinalEvents(events);

    expect(mocks.getCurrentUrl).toHaveBeenCalledTimes(1);
    expect(mocks.waitForNavigation).toHaveBeenCalledWith(
      "https://example.com/next",
      expect.any(Function),
    );
    expect(result).toEqual([
      { event: "existing" },
      { event: "pre" },
      { event: "post" },
    ]);
    expect(stderr.mock.calls.join("")).toContain("Capturing dataLayer events");
    expect(stderr.mock.calls.join("")).toContain("Captured 3 event(s)");
  });

  it("delegates browser shutdown", async () => {
    const { closeRunBrowser, mocks } = await setupRuntimeModule();

    await closeRunBrowser();

    expect(mocks.closeBrowser).toHaveBeenCalledTimes(1);
  });

  it("PLAYBOOK_FILE is the expected filename", async () => {
    const { PLAYBOOK_FILE } = await setupRuntimeModule();
    expect(PLAYBOOK_FILE).toBe(".tracking-agent-playbook.json");
  });

  it("falls back to empty string for waitForNavigation when getCurrentUrl rejects", async () => {
    vi.resetModules();
    const drainInterceptor = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const getCurrentUrl = vi.fn().mockRejectedValue(new Error("browser gone"));
    const waitForNavigation = vi.fn().mockResolvedValue(undefined);
    vi.doMock("../schema.js", () => ({
      discoverEventSchemas: vi.fn().mockResolvedValue([]),
    }));
    const defaultBrowserFn2 = vi.fn();
    vi.doMock("../browser/runner.js", () => ({
      closeBrowser: vi.fn(),
      defaultBrowserFn: defaultBrowserFn2,
      drainInterceptor,
      getCurrentUrl,
      loadSession: vi.fn(),
      navigateTo: vi.fn(),
      startHeadedBrowser: vi.fn(),
      waitForNavigation,
    }));
    const { captureFinalEvents } = await import("./runtime.js");

    await captureFinalEvents([]);

    expect(waitForNavigation).toHaveBeenCalledWith("", expect.any(Function));
  });
});
