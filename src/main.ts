import chalk from "chalk";
import { resolveArgs } from "./cli/args.js";
import { printHelp } from "./cli/help.js";
import {
  drainInterceptor,
  generateReport,
  saveReportFolder,
  validateAll,
} from "./browser/runner.js";
import { buildAgentTools } from "./agent/runtime.js";
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

  const { schemaUrl, targetUrl, resume, replay, headless, schemasDir } = args;

  const mode = replay ? "replay" : resume ? "resume" : "fresh";
  process.stderr.write(
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
  );
  await openBrowser(targetUrl, headless);

  const accumulatedEvents: unknown[] = [];
  const landingEvents = await drainInterceptor();
  accumulatedEvents.push(...landingEvents);
  const { tools: agentTools } = buildAgentTools(accumulatedEvents, headless);

  if (replay) {
    await runReplayMode(schemaUrl, targetUrl, eventSchemas, agentTools, accumulatedEvents);
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
    );
  }

  const events = await captureFinalEvents(accumulatedEvents);

  process.stderr.write(chalk.dim(`  Validating events...\n`));
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
    process.stderr.write(chalk.dim(`  Report saved → ${reportDir}\n\n`));
  }

  await closeRunBrowser();
}
