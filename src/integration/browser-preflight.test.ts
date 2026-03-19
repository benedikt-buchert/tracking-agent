import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureBrowserIntegrationReady } from "./browser-preflight.js";

describe("ensureBrowserIntegrationReady", () => {
  const originalHeaded = process.env["AGENT_BROWSER_HEADED"];

  beforeEach(() => {
    process.env["AGENT_BROWSER_HEADED"] = "true";
  });

  afterEach(() => {
    if (originalHeaded === undefined)
      delete process.env["AGENT_BROWSER_HEADED"];
    else process.env["AGENT_BROWSER_HEADED"] = originalHeaded;
    vi.restoreAllMocks();
  });

  it("runs preflight headless and restores the caller headed setting", async () => {
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
});
