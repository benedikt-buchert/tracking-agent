import { spawn } from "child_process";
import { closeBrowser } from "../browser/runner.js";

async function bestEffortCloseBrowser(): Promise<void> {
  await closeBrowser().catch(() => {
    /* non-fatal cleanup */
  });
}

async function main(): Promise<void> {
  const separatorIndex = process.argv.indexOf("--");
  const commandArgs =
    separatorIndex >= 0 ? process.argv.slice(separatorIndex + 1) : [];

  if (commandArgs.length === 0) {
    throw new Error("Expected a command after '--'");
  }

  const [command, ...args] = commandArgs;

  await bestEffortCloseBrowser();

  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env,
    });

    const forwardSignal = async (signal: NodeJS.Signals) => {
      child.kill(signal);
      await bestEffortCloseBrowser();
      process.exit(1);
    };

    process.once("SIGINT", forwardSignal);
    process.once("SIGTERM", forwardSignal);

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      process.removeListener("SIGINT", forwardSignal);
      process.removeListener("SIGTERM", forwardSignal);

      if (signal) resolve(1);
      else resolve(code ?? 1);
    });
  });

  await bestEffortCloseBrowser();
  process.exit(exitCode);
}

await main();
