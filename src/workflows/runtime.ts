import chalk from "chalk";
import { discoverEventSchemas } from "../schema.js";
import type { EventSchema } from "../schema.js";
import {
  createLocalFirstLoader,
  defaultLoadSchema,
} from "../validation/index.js";
import type { LoadSchemaFn } from "../validation/index.js";
import {
  closeBrowser,
  drainInterceptor,
  getCurrentUrl,
  loadSession,
  navigateTo,
  startHeadedBrowser,
  waitForNavigation,
} from "../browser/runner.js";

export const SESSION_FILE = ".tracking-agent-session.json";
export const PLAYBOOK_FILE = ".tracking-agent-playbook.json";

export async function loadRunState(
  schemaUrl: string,
  resume: boolean,
  schemasDir?: string,
): Promise<{
  eventSchemas: EventSchema[];
  savedMessages: unknown[];
  foundEventNames: string[];
  loadSchemaFn: LoadSchemaFn;
}> {
  const loadSchemaFn = schemasDir
    ? createLocalFirstLoader(schemasDir)
    : defaultLoadSchema;

  if (resume) {
    process.stderr.write(
      chalk.dim(`  Loading session from ${SESSION_FILE}...\n`),
    );
    const session = await loadSession(SESSION_FILE);
    process.stderr.write(
      chalk.dim(
        `  Restored ${session.eventSchemas.length} schema(s), ${session.messages.length} messages\n\n`,
      ),
    );
    return {
      eventSchemas: session.eventSchemas,
      savedMessages: session.messages,
      foundEventNames: session.foundEventNames ?? [],
      loadSchemaFn,
    };
  }

  process.stderr.write(
    chalk.dim(`  Discovering schemas from ${schemaUrl}...\n`),
  );
  const eventSchemas = await discoverEventSchemas(
    schemaUrl,
    "web-datalayer-js",
    loadSchemaFn,
  );
  process.stderr.write(
    chalk.dim(`  Found ${eventSchemas.length} event schema(s)\n\n`),
  );
  return { eventSchemas, savedMessages: [], foundEventNames: [], loadSchemaFn };
}

export async function openBrowser(
  targetUrl: string,
  headless: boolean,
): Promise<void> {
  if (headless) {
    delete process.env["AGENT_BROWSER_HEADED"];
    process.stderr.write(chalk.dim(`  Starting headless browser...\n`));
  } else {
    await startHeadedBrowser();
    process.stderr.write(chalk.dim(`  Starting headed browser...\n`));
  }
  process.stderr.write(chalk.dim(`  Opening ${targetUrl}...\n\n`));
  await navigateTo(targetUrl);
}

export async function captureFinalEvents(
  accumulatedEvents: unknown[],
): Promise<unknown[]> {
  process.stderr.write(chalk.dim(`\n  Capturing dataLayer events...\n`));
  const preNavEvents = await drainInterceptor();
  accumulatedEvents.push(...preNavEvents);
  const currentUrl = await getCurrentUrl().catch(() => "");
  await waitForNavigation(currentUrl);
  const postNavEvents = await drainInterceptor();
  accumulatedEvents.push(...postNavEvents);
  process.stderr.write(
    chalk.dim(`  Captured ${accumulatedEvents.length} event(s)\n\n`),
  );
  return accumulatedEvents;
}

export async function closeRunBrowser(): Promise<void> {
  await closeBrowser();
}
