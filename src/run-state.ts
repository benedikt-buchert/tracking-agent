import { readFile, writeFile } from "fs/promises";
import chalk from "chalk";
import type { Logger } from "./cli/logger.js";
import { discoverEventSchemas, type EventSchema } from "./schema.js";
import {
  createLocalFirstLoader,
  defaultLoadSchema,
} from "./validation/index.js";
import type { LoadSchemaFn } from "./validation/index.js";

const SESSION_FILE = ".tracking-agent-session.json";

interface RunSession {
  schemaUrl: string;
  targetUrl: string;
  eventSchemas: EventSchema[];
  foundEventNames?: string[];
}

export async function loadRunState(
  schemaUrl: string,
  resume: boolean,
  schemasDir?: string,
  log?: Logger,
): Promise<{
  eventSchemas: EventSchema[];
  loadSchemaFn: LoadSchemaFn;
}> {
  const loadSchemaFn = schemasDir
    ? createLocalFirstLoader(schemasDir)
    : defaultLoadSchema;

  if (resume) {
    log?.info(chalk.dim(`  Loading session from ${SESSION_FILE}...\n`));
    const session = await loadSession(SESSION_FILE);
    log?.info(
      chalk.dim(`  Restored ${session.eventSchemas.length} schema(s)\n\n`),
    );
    return {
      eventSchemas: session.eventSchemas,
      loadSchemaFn,
    };
  }

  log?.info(chalk.dim(`  Discovering schemas from ${schemaUrl}...\n`));
  const eventSchemas = await discoverEventSchemas(
    schemaUrl,
    "web-datalayer-js",
    loadSchemaFn,
  );
  log?.info(chalk.dim(`  Found ${eventSchemas.length} event schema(s)\n\n`));
  return { eventSchemas, loadSchemaFn };
}

export async function saveRunSession(session: RunSession): Promise<void> {
  await writeFile(SESSION_FILE, JSON.stringify(session, null, 2), "utf8");
}

async function loadSession(filePath: string): Promise<RunSession> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as RunSession;
}
