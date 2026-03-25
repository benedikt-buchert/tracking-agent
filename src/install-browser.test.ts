import { describe, expect, it, vi } from "vitest";
import { installBrowser } from "./install-browser.js";

describe("installBrowser", () => {
  it("invokes the resolved agent-browser binary with the install command", () => {
    const execFileSyncFn = vi.fn();
    const resolveBin = vi.fn().mockReturnValue("/pkg/node_modules/.bin/agent-browser");

    installBrowser(execFileSyncFn, resolveBin);

    expect(resolveBin).toHaveBeenCalledTimes(1);
    expect(execFileSyncFn).toHaveBeenCalledWith(
      "/pkg/node_modules/.bin/agent-browser",
      ["install"],
      { stdio: "inherit" },
    );
  });
});
