import chalk from "chalk";
import { createInterface } from "node:readline/promises";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveArgs } from "./cli/args.js";
import { printHelp } from "./cli/help.js";
import { createLogger } from "./cli/logger.js";
import type { Verbosity } from "./cli/logger.js";
import {
  generateReport,
  saveReportFolder,
  validateAll,
} from "./browser/report.js";
import { loadCredentials, formatCredentialsSummary } from "./credentials.js";
import { runStagehandCase } from "./harness/stagehand-runner.js";
import { loadRunState, saveRunSession } from "./run-state.js";
import type { EventSchema } from "./schema.js";
import type { SignalBackedCase } from "./harness/types.js";

function observedEventNames(events: unknown[]): string[] {
  const names = new Set<string>();
  for (const event of events) {
    if (event && typeof event === "object") {
      const name = (event as Record<string, unknown>)["event"];
      if (typeof name === "string") names.add(name);
    }
  }
  return [...names];
}

function buildJourneyHint(
  eventSchemas: EventSchema[],
  credentialsSummary: string,
): string {
  if (eventSchemas.length === 0) {
    const base = "Explore the site and trigger the important tracked interaction.";
    return credentialsSummary ? `${base} ${credentialsSummary}` : base;
  }
  const eventLines = eventSchemas
    .map((schema) =>
      schema.description
        ? `- ${schema.eventName}: ${schema.description}`
        : `- ${schema.eventName}`,
    )
    .join("\n");
  const base = `Reach and trigger the following tracked events on this site:\n${eventLines}`;
  return credentialsSummary ? `${base}\n${credentialsSummary}` : base;
}

function buildStagehandCase(
  targetUrl: string,
  eventSchemas: EventSchema[],
  credentialsSummary: string,
): SignalBackedCase {
  const siteId = new URL(targetUrl).hostname;
  return {
    $schema: "./schemas/signal-backed-case.schema.json",
    case_id: "cli-run",
    site_id: siteId,
    family_id: null,
    kind: "live",
    entry_url: targetUrl,
    journey_hint: buildJourneyHint(eventSchemas, credentialsSummary),
    expected_signals: {
      tracking_surfaces: ["dataLayer"],
      important_event_names_any_of: eventSchemas.map(
        (schema) => schema.eventName,
      ),
      min_events_total: 1,
      min_unique_event_names: 1,
    },
    budgets: {
      max_action_steps: 20,
      max_no_progress_actions: 6,
    },
    grader: { type: "heuristic", strictness: "medium" },
  };
}

function resolvePhaseTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const raw = env["STAGEHAND_PHASE_TIMEOUT_MS"];
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

async function promptForIntervention(): Promise<"continue" | "stop"> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  let interrupted = false;
  const handleSigint = () => {
    interrupted = true;
    readline.close();
  };
  process.once("SIGINT", handleSigint);

  try {
    process.stderr.write(
      chalk.yellow(
        `\n  Stagehand paused. Take over in the open browser if needed.\n`,
      ),
    );
    const answer = await readline.question(
      "  Press Enter when you want to continue reporting, or type 'stop': ",
    );
    if (interrupted) return "stop";
    return answer.trim().toLowerCase() === "stop" ? "stop" : "continue";
  } catch {
    return "stop";
  } finally {
    process.off("SIGINT", handleSigint);
    readline.close();
  }
}

export async function main(): Promise<void> {
  const args = await resolveArgs(process.argv.slice(2));

  if (!args) {
    printHelp();
    return;
  }

  const {
    schemaUrl,
    targetUrl,
    resume,
    replay,
    headless,
    schemasDir,
    credentials,
    quiet,
    verbose,
  } = args;

  const verbosity: Verbosity = quiet ? "quiet" : verbose ? "verbose" : "normal";
  const log = createLogger(verbosity);

  const mode = replay ? "replay" : resume ? "resume" : "fresh";
  log.info(
    chalk.bold("\n  Tracking Agent\n") +
      chalk.dim(`  Schema: ${schemaUrl}\n  Target: ${targetUrl}\n`) +
      (mode !== "fresh" ? chalk.dim(`  Mode: ${mode}\n`) : "") +
      (headless ? chalk.dim("  Browser: headless\n") : "") +
      "\n",
  );

  const { eventSchemas, loadSchemaFn } = await loadRunState(
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
  const stagehandVariables = credentialStore?.stagehandVariables();

  const stagehandCase = buildStagehandCase(
    targetUrl,
    eventSchemas,
    credentialsSummary,
  );
  const stagehandRun = await runStagehandCase(stagehandCase, {
    headless,
    phaseTimeoutMs: resolvePhaseTimeoutMs(),
    variables: stagehandVariables,
    onInterventionNeeded: async () => promptForIntervention(),
  });
  const events = stagehandRun.accumulatedEvents;

  await saveRunSession({
    schemaUrl,
    targetUrl,
    eventSchemas,
    foundEventNames: observedEventNames(events),
  }).catch(() => {});

  log.verbose(chalk.dim("  Validating events...\n"));
  const results = await validateAll(
    events,
    eventSchemas,
    schemaUrl,
    loadSchemaFn,
  );

  const expectedNames = eventSchemas.map((schema) => schema.eventName);
  const report = generateReport(results, expectedNames, events, eventSchemas);
  process.stdout.write(report);

  const reportDir = await saveReportFolder(
    "tracking-reports",
    events,
    results,
    expectedNames,
    report,
  ).catch(() => null);
  if (reportDir && stagehandRun.captureDiagnostics) {
    await writeFile(
      join(reportDir, "capture-diagnostics.json"),
      JSON.stringify(stagehandRun.captureDiagnostics, null, 2),
      "utf8",
    ).catch(() => {});
  }
  if (reportDir) {
    log.info(chalk.dim(`  Report saved → ${reportDir}\n\n`));
  }
}
