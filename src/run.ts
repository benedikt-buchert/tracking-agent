#!/usr/bin/env node
import { main } from "./main.js";

type WriteFn = (text: string) => void;
type ExitFn = (code: number) => never;

export function loadEnvIfPresent(
  loadEnvFile: () => void = process.loadEnvFile,
): void {
  try {
    loadEnvFile();
  } catch {
    /* no .env file, continue */
  }
}

export function handleMainError(
  err: unknown,
  write: WriteFn = (text) => process.stderr.write(text),
  exit: ExitFn = (code) => process.exit(code),
): never {
  if (
    err instanceof Error &&
    (err.name === "ConfigurationError" ||
      err.message.toLowerCase().includes("requires"))
  ) {
    write(err.message);
  } else {
    write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  }
  return exit(1);
}

export async function run(
  mainFn: () => Promise<void> = main,
  loadEnvFile: () => void = process.loadEnvFile,
  onError: (err: unknown) => never = handleMainError,
): Promise<void> {
  loadEnvIfPresent(loadEnvFile);
  try {
    await mainFn();
  } catch (err) {
    onError(err);
  }
}

if (process.env["VITEST"] !== "true") {
  await run();
}
