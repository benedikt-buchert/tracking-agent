import { runAgentBrowser } from "../browser/runner.js";

type BrowserRunner = typeof runAgentBrowser;

let checked = false;

export async function ensureBrowserIntegrationReady(
  browserRunner: BrowserRunner = runAgentBrowser,
): Promise<void> {
  if (checked) return;

  const originalHeaded = process.env["AGENT_BROWSER_HEADED"];
  delete process.env["AGENT_BROWSER_HEADED"];

  try {
    await browserRunner(["close"]).catch(() => {
      /* clear stale daemon/session state */
    });

    const result = await browserRunner([
      "open",
      "https://example.com",
      "--json",
    ]);

    await browserRunner(["close"]).catch(() => {
      /* non-fatal */
    });

    if (!result.includes('"success":true')) {
      throw new Error(
        `agent-browser preflight failed: ${result || "empty output"}\n` +
          `Run 'agent-browser install' once and retry if browser binaries are missing.`,
      );
    }

    checked = true;
  } finally {
    if (originalHeaded === undefined)
      delete process.env["AGENT_BROWSER_HEADED"];
    else process.env["AGENT_BROWSER_HEADED"] = originalHeaded;
  }
}
