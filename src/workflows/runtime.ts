import chalk from "chalk";
import { createLogger } from "../cli/logger.js";
import type { Logger } from "../cli/logger.js";
import { discoverEventSchemas } from "../schema.js";
import type { EventSchema } from "../schema.js";
import {
  createLocalFirstLoader,
  defaultLoadSchema,
} from "../validation/index.js";
import type { LoadSchemaFn } from "../validation/index.js";
import type { BrowserFn } from "../browser/runner.js";
import {
  closeBrowser,
  defaultBrowserFn,
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
  log: Logger = createLogger(),
): Promise<{
  eventSchemas: EventSchema[];
  savedMessages: unknown[];
  foundEventNames: string[];
  skippedEvents: { name: string; reason: string }[];
  loadSchemaFn: LoadSchemaFn;
}> {
  const loadSchemaFn = schemasDir
    ? createLocalFirstLoader(schemasDir)
    : defaultLoadSchema;

  if (resume) {
    log.info(chalk.dim(`  Loading session from ${SESSION_FILE}...\n`));
    const session = await loadSession(SESSION_FILE);
    log.info(
      chalk.dim(
        `  Restored ${session.eventSchemas.length} schema(s), ${session.messages.length} messages\n\n`,
      ),
    );
    return {
      eventSchemas: session.eventSchemas,
      savedMessages: session.messages,
      foundEventNames: session.foundEventNames ?? [],
      skippedEvents: session.skippedEvents ?? [],
      loadSchemaFn,
    };
  }

  log.info(chalk.dim(`  Discovering schemas from ${schemaUrl}...\n`));
  const eventSchemas = await discoverEventSchemas(
    schemaUrl,
    "web-datalayer-js",
    loadSchemaFn,
  );
  log.info(chalk.dim(`  Found ${eventSchemas.length} event schema(s)\n\n`));
  return { eventSchemas, savedMessages: [], foundEventNames: [], skippedEvents: [], loadSchemaFn };
}

export async function openBrowser(
  targetUrl: string,
  headless: boolean,
  browser: BrowserFn = defaultBrowserFn,
  log: Logger = createLogger(),
): Promise<void> {
  if (headless) {
    delete process.env["AGENT_BROWSER_HEADED"];
    log.info(chalk.dim(`  Starting headless browser...\n`));
  } else {
    await startHeadedBrowser(browser);
    log.info(chalk.dim(`  Starting headed browser...\n`));
  }
  log.info(chalk.dim(`  Opening ${targetUrl}...\n\n`));
  await navigateTo(targetUrl, browser);
}

export async function captureFinalEvents(
  accumulatedEvents: unknown[],
  browser: BrowserFn = defaultBrowserFn,
  log: Logger = createLogger(),
): Promise<unknown[]> {
  log.info(chalk.dim(`\n  Capturing dataLayer events...\n`));
  const preNavEvents = await drainInterceptor(browser);
  accumulatedEvents.push(...preNavEvents);
  const currentUrl = await getCurrentUrl(browser).catch(() => "");
  await waitForNavigation(currentUrl, browser);
  const postNavEvents = await drainInterceptor(browser);
  accumulatedEvents.push(...postNavEvents);
  log.info(chalk.dim(`  Captured ${accumulatedEvents.length} event(s)\n\n`));
  return accumulatedEvents;
}

export async function closeRunBrowser(
  browser: BrowserFn = defaultBrowserFn,
): Promise<void> {
  await closeBrowser(browser);
}
