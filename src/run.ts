#!/usr/bin/env node
// Load .env from the current working directory if it exists
try {
  process.loadEnvFile();
} catch {
  /* no .env file, continue */
}

import { main } from "./main.js";
import { ConfigurationError } from "./agent/runtime.js";

main().catch((err: unknown) => {
  if (err instanceof ConfigurationError) {
    process.stderr.write(err.message);
  } else {
    process.stderr.write(
      `Error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
  process.exit(1);
});
