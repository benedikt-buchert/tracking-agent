#!/usr/bin/env node
import { main } from "./main.js";
import { ConfigurationError } from "./agent/runtime.js";

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
  if (err instanceof ConfigurationError) {
    write(err.message);
  } else {
    write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  }
  return exit(1);
}

export function run(): void {
  loadEnvIfPresent();
  main().catch((err: unknown) => {
    handleMainError(err);
  });
}

if (process.env["VITEST"] !== "true") {
  run();
}
