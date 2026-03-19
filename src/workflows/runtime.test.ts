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
  vi.doMock("../browser/runner.js", () => ({
    closeBrowser,
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

  it("discovers schemas when not resuming", async () => {
    const { loadRunState, mocks } = await setupRuntimeModule();

    const result = await loadRunState("https://example.com/schema.json", false);

    expect(mocks.discoverEventSchemas).toHaveBeenCalledWith(
      "https://example.com/schema.json",
      "web-datalayer-js",
    );
    expect(result.eventSchemas).toHaveLength(1);
    expect(result.savedMessages).toEqual([]);
    expect(stderr.mock.calls.join("")).toContain(
      "Discovering schemas from https://example.com/schema.json",
    );
    expect(stderr.mock.calls.join("")).toContain("Found 1 event schema(s)");
  });

  it("starts headed browser when headless is false", async () => {
    const { openBrowser, mocks } = await setupRuntimeModule();

    await openBrowser("https://example.com", false);

    expect(mocks.startHeadedBrowser).toHaveBeenCalledTimes(1);
    expect(mocks.navigateTo).toHaveBeenCalledWith("https://example.com");
    expect(stderr.mock.calls.join("")).toContain("Starting headed browser");
    expect(stderr.mock.calls.join("")).toContain("Opening https://example.com");
  });

  it("skips headed startup and clears AGENT_BROWSER_HEADED in headless mode", async () => {
    process.env["AGENT_BROWSER_HEADED"] = "1";
    const { openBrowser, mocks } = await setupRuntimeModule();

    await openBrowser("https://example.com", true);

    expect(mocks.startHeadedBrowser).not.toHaveBeenCalled();
    expect(process.env["AGENT_BROWSER_HEADED"]).toBeUndefined();
    expect(mocks.navigateTo).toHaveBeenCalledWith("https://example.com");
    expect(stderr.mock.calls.join("")).toContain("Starting headless browser");
  });

  it("captures pre- and post-navigation events", async () => {
    const { captureFinalEvents, mocks } = await setupRuntimeModule();
    const events = [{ event: "existing" }];

    const result = await captureFinalEvents(events);

    expect(mocks.getCurrentUrl).toHaveBeenCalledTimes(1);
    expect(mocks.waitForNavigation).toHaveBeenCalledWith(
      "https://example.com/next",
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
});
