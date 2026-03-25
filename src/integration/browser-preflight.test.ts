import { afterEach, describe, expect, it, vi } from "vitest";

async function loadFreshModule() {
  vi.resetModules();
  const mod = await import("./browser-preflight.js");
  return mod.ensureBrowserIntegrationReady;
}

describe("ensureBrowserIntegrationReady", () => {
  const originalHeaded = process.env["AGENT_BROWSER_HEADED"];

  afterEach(() => {
    if (originalHeaded === undefined)
      delete process.env["AGENT_BROWSER_HEADED"];
    else process.env["AGENT_BROWSER_HEADED"] = originalHeaded;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("runs preflight headless and restores the caller headed setting", async () => {
    process.env["AGENT_BROWSER_HEADED"] = "true";
    const ensureBrowserIntegrationReady = await loadFreshModule();
    const runAgentBrowser = vi
      .fn()
      .mockResolvedValueOnce('{"success":true}')
      .mockResolvedValueOnce('{"success":true}')
      .mockResolvedValueOnce('{"success":true}');

    await ensureBrowserIntegrationReady(runAgentBrowser);

    expect(process.env["AGENT_BROWSER_HEADED"]).toBe("true");
    expect(runAgentBrowser).toHaveBeenCalledWith(["close"]);
    expect(runAgentBrowser).toHaveBeenCalledWith([
      "open",
      "https://example.com",
      "--json",
    ]);
  });

  it("throws when the browser result does not include success:true", async () => {
    const ensureBrowserIntegrationReady = await loadFreshModule();
    const runAgentBrowser = vi
      .fn()
      .mockResolvedValueOnce("") // first close
      .mockResolvedValueOnce('{"success":false,"error":"not installed"}') // open
      .mockResolvedValueOnce(""); // second close

    await expect(
      ensureBrowserIntegrationReady(runAgentBrowser),
    ).rejects.toThrow("agent-browser preflight failed");
  });

  it("includes empty output message when result is an empty string", async () => {
    const ensureBrowserIntegrationReady = await loadFreshModule();
    const runAgentBrowser = vi
      .fn()
      .mockResolvedValueOnce("") // first close
      .mockResolvedValueOnce("") // open returns empty string
      .mockResolvedValueOnce(""); // second close

    await expect(
      ensureBrowserIntegrationReady(runAgentBrowser),
    ).rejects.toThrow("empty output");
  });

  it("includes the actual result text when result is non-empty but not success", async () => {
    const ensureBrowserIntegrationReady = await loadFreshModule();
    const errorText = '{"error":"browser not found"}';
    const runAgentBrowser = vi
      .fn()
      .mockResolvedValueOnce("") // first close
      .mockResolvedValueOnce(errorText) // open
      .mockResolvedValueOnce(""); // second close

    await expect(
      ensureBrowserIntegrationReady(runAgentBrowser),
    ).rejects.toThrow(errorText);
  });

  it("includes the install hint in the error message", async () => {
    const ensureBrowserIntegrationReady = await loadFreshModule();
    const runAgentBrowser = vi
      .fn()
      .mockResolvedValueOnce("") // first close
      .mockResolvedValueOnce("") // open
      .mockResolvedValueOnce(""); // second close

    await expect(
      ensureBrowserIntegrationReady(runAgentBrowser),
    ).rejects.toThrow("tracking-agent-install-browser");
  });

  it("sets checked=true so a second call skips the browser runner", async () => {
    const ensureBrowserIntegrationReady = await loadFreshModule();
    const runAgentBrowser = vi.fn().mockResolvedValue('{"success":true}');

    await ensureBrowserIntegrationReady(runAgentBrowser);
    await ensureBrowserIntegrationReady(runAgentBrowser);

    // close + open + close = 3 calls total, but second call is skipped due to checked=true
    expect(runAgentBrowser).toHaveBeenCalledTimes(3);
  });

  it("deletes AGENT_BROWSER_HEADED during preflight even if it was undefined", async () => {
    delete process.env["AGENT_BROWSER_HEADED"];
    const ensureBrowserIntegrationReady = await loadFreshModule();
    const runAgentBrowser = vi.fn().mockResolvedValue('{"success":true}');

    await ensureBrowserIntegrationReady(runAgentBrowser);

    // env should remain unset after completion
    expect(process.env["AGENT_BROWSER_HEADED"]).toBeUndefined();
  });
});
