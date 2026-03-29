import { spawn } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";

export function resolveCommand(
  command: string,
  {
    cwd = process.cwd(),
    existsSyncFn = existsSync,
  }: {
    cwd?: string;
    existsSyncFn?: typeof existsSync;
  } = {},
): string {
  if (command.includes("/") || command.includes("\\")) return command;

  const localBin = resolve(cwd, "node_modules", ".bin", command);
  return existsSyncFn(localBin) ? localBin : command;
}

async function main(): Promise<void> {
  const separatorIndex = process.argv.indexOf("--");
  const commandArgs =
    separatorIndex >= 0 ? process.argv.slice(separatorIndex + 1) : [];

  if (commandArgs.length === 0) {
    throw new Error("Expected a command after '--'");
  }

  const [command, ...args] = commandArgs;
  const resolvedCommand = resolveCommand(command!);

  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(resolvedCommand, args, {
      stdio: "inherit",
      env: process.env,
    });

    const forwardSignal = async (signal: NodeJS.Signals) => {
      child.kill(signal);
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

  process.exit(exitCode);
}

function isEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(entry).href === import.meta.url;
}

if (isEntrypoint()) {
  await main();
}
