import chalk from "chalk";
import { resolveArgs } from "./cli/args.js";
import { printHelp } from "./cli/help.js";
import { createLogger } from "./cli/logger.js";
import type { Verbosity } from "./cli/logger.js";
import {
  drainInterceptor,
  generateReport,
  saveReportFolder,
  validateAll,
} from "./browser/runner.js";
import { buildAgentTools } from "./agent/runtime.js";
import { loadCredentials, formatCredentialsSummary } from "./credentials.js";
import {
  captureFinalEvents,
  closeRunBrowser,
  loadRunState,
  openBrowser,
} from "./workflows/runtime.js";
import {
  runInteractiveMode,
  runReplayMode,
} from "./workflows/agent-workflows.js";

export async function main(): Promise<void> {
  const args = await resolveArgs(process.argv.slice(2));

  if (!args) {
    printHelp();
    return;
  }

  const { schemaUrl, targetUrl, resume, replay, headless, schemasDir, credentials, quiet, verbose } = args;

  const verbosity: Verbosity = quiet ? "quiet" : verbose ? "verbose" : "normal";
  const log = createLogger(verbosity);

  const mode = replay ? "replay" : resume ? "resume" : "fresh";
  log.info(
    chalk.bold("\n  Tracking Agent\n") +
      chalk.dim(`  Schema: ${schemaUrl}\n  Target: ${targetUrl}\n`) +
      (mode !== "fresh" ? chalk.dim(`  Mode: ${mode}\n`) : "") +
      (headless ? chalk.dim(`  Browser: headless\n`) : "") +
      "\n",
  );

  const { eventSchemas, savedMessages, foundEventNames, skippedEvents, loadSchemaFn } = await loadRunState(
    schemaUrl,
    resume,
    schemasDir,
    log,
  );
  const credentialStore = credentials
    ? await loadCredentials(credentials)
    : undefined;
  const credentialsSummary = credentialStore
    ? formatCredentialsSummary(credentialStore.fieldSummary())
    : "";
  const accumulatedEvents: unknown[] = [];
  const { tools: agentTools, browserFn } = buildAgentTools(accumulatedEvents, headless, undefined, credentialStore, log);

  await openBrowser(targetUrl, headless, browserFn, log);
  const landingEvents = await drainInterceptor(browserFn, log);
  accumulatedEvents.push(...landingEvents);

  if (replay) {
    await runReplayMode(schemaUrl, targetUrl, eventSchemas, agentTools, accumulatedEvents, credentialsSummary, log);
  } else {
    await runInteractiveMode(
      schemaUrl,
      targetUrl,
      eventSchemas,
      savedMessages,
      resume,
      agentTools,
      accumulatedEvents,
      foundEventNames,
      skippedEvents,
      credentialsSummary,
      log,
    );
  }

  const events = await captureFinalEvents(accumulatedEvents, browserFn, log);

  log.verbose(chalk.dim(`  Validating events...\n`));
  const results = await validateAll(events, eventSchemas, schemaUrl, loadSchemaFn);

  const expectedNames = eventSchemas.map((s) => s.eventName);
  const report = generateReport(results, expectedNames, events, eventSchemas);
  process.stdout.write(report);

  const reportDir = await saveReportFolder(
    "tracking-reports",
    events,
    results,
    expectedNames,
    report,
  ).catch(() => null);
  if (reportDir) {
    log.info(chalk.dim(`  Report saved → ${reportDir}\n\n`));
  }

  await closeRunBrowser(browserFn);
}
