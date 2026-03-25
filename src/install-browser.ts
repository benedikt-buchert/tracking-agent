#!/usr/bin/env node
import { execFileSync } from "child_process";
import { resolveAgentBrowserBin } from "./browser/runner.js";

export function installBrowser(
  execFileSyncFn: typeof execFileSync = execFileSync,
  resolveBin: () => string = resolveAgentBrowserBin,
): void {
  execFileSyncFn(resolveBin(), ["install"], { stdio: "inherit" });
}

if (process.env["VITEST"] !== "true") {
  installBrowser();
}
