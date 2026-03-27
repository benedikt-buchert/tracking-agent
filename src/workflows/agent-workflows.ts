import type { Agent } from "@mariozechner/pi-agent-core";
import chalk from "chalk";
import { createLogger } from "../cli/logger.js";
import type { Logger } from "../cli/logger.js";
import type { allTools } from "../browser/tools.js";
import { createSkipTaskTool } from "../browser/tools.js";
import type { EventSchema } from "../schema.js";
import {
  extractPlaybookSteps,
  isActionTool,
  loadPlaybook,
  replayPlaybook,
  savePlaybook,
  saveSession,
} from "../browser/runner.js";
import type {
  AgentSession,
  PlaybookStep,
  StepExecutor,
} from "../browser/runner.js";
import { createConsoleHandler } from "../agent/console-handler.js";
import { buildInitialPrompt, createSystemPrompt, readPrompt } from "../agent/prompts.js";
import { collectAgentText, createAgent } from "../agent/runtime.js";
import { createTaskList } from "../agent/task-list.js";
import type { TaskList } from "../agent/task-list.js";
import { PLAYBOOK_FILE, SESSION_FILE } from "./runtime.js";

function attachTaskListDisplay(
  agent: Agent,
  taskList: TaskList,
  accumulatedEvents: unknown[],
  log: Logger = createLogger(),
): void {
  agent.subscribe((event) => {
    if (event.type === "turn_start") {
      const header = chalk.bold(`\n  ◈ Tasks ${taskList.foundCount}/${taskList.totalCount}\n`) +
        taskList.tasks
          .map((t) =>
            t.status === "found"
              ? chalk.green(`  ✓ ${t.eventName}`)
              : t.status === "skipped"
                ? chalk.yellow(`  ~ ${t.eventName}`)
                : chalk.dim(`  ✗ ${t.eventName}`),
          )
          .join("\n") +
        "\n";
      log.info(header);
    }
    if (
      event.type === "tool_execution_end" &&
      isActionTool((event as { toolName: string }).toolName)
    ) {
      taskList.update(accumulatedEvents);
      log.info(chalk.dim(`  ◈ ${taskList.formatCompact()}\n`));
    }
  });
}

function makeStepExecutor(tools: typeof allTools): StepExecutor {
  return async (step: PlaybookStep) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tool = tools.find((t) => t.name === step.tool) as any;
    if (!tool) return `Error: unknown tool ${step.tool}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await tool.execute("replay", step.args as any);
    return (result.content[0] as { text: string }).text ?? "";
  };
}

function attachStepRecording(
  agent: Agent,
  steps: PlaybookStep[],
  isRecording: () => boolean,
): void {
  agent.subscribe((event) => {
    if (
      isRecording() &&
      event.type === "tool_execution_start" &&
      isActionTool(event.toolName)
    ) {
      steps.push({
        tool: event.toolName,
        args: event.args as Record<string, unknown>,
      });
    }
  });
}

function attachSessionPersistence(
  agent: Agent,
  schemaUrl: string,
  targetUrl: string,
  eventSchemas: EventSchema[],
  getAccumulatedEvents: () => unknown[] = () => [],
  getTaskList?: () => TaskList,
): void {
  agent.subscribe(async (event) => {
    if (event.type === "turn_end") {
      const events = getAccumulatedEvents();
      const foundEventNames = eventSchemas
        .map((s) => s.eventName)
        .filter((name) =>
          events.some(
            (e) =>
              e !== null &&
              typeof e === "object" &&
              (e as Record<string, unknown>)["event"] === name,
          ),
        );
      const taskList = getTaskList?.();
      const skippedEvents = taskList
        ? taskList.tasks
            .filter((t) => t.status === "skipped")
            .map((t) => ({ name: t.eventName, reason: t.skipReason ?? "" }))
        : undefined;
      const session: AgentSession = {
        schemaUrl,
        targetUrl,
        eventSchemas,
        messages: agent.state.messages,
        foundEventNames,
        ...(skippedEvents && skippedEvents.length > 0 ? { skippedEvents } : {}),
      };
      await saveSession(SESSION_FILE, session).catch(() => {
        /* non-fatal */
      });
    }
  });
}

function createConfiguredAgent(
  agentTools: typeof allTools,
  schemaUrl: string,
  targetUrl: string,
  eventSchemas: EventSchema[],
  purpose: string,
  getAccumulatedEvents: () => unknown[] = () => [],
  getTaskList?: () => TaskList,
  log: Logger = createLogger(),
): Agent {
  const agent = createAgent(purpose);
  agent.setTools(agentTools);
  attachSessionPersistence(agent, schemaUrl, targetUrl, eventSchemas, getAccumulatedEvents, getTaskList);
  agent.subscribe(createConsoleHandler(undefined, log));
  return agent;
}

export async function runReplayMode(
  schemaUrl: string,
  targetUrl: string,
  eventSchemas: EventSchema[],
  agentTools: typeof allTools,
  accumulatedEvents: unknown[] = [],
  credentialsSummary = "",
  log: Logger = createLogger(),
): Promise<void> {
  log.info(chalk.dim(`  Loading playbook from ${PLAYBOOK_FILE}...\n`));
  const playbook = await loadPlaybook(PLAYBOOK_FILE);
  log.info(chalk.dim(`  Replaying ${playbook.steps.length} step(s)...\n\n`));

  const executor = makeStepExecutor(agentTools);
  const { stuckAtIndex } = await replayPlaybook(playbook.steps, executor);

  if (stuckAtIndex === -1) {
    log.info(chalk.dim(`\n  Replay complete — all steps succeeded, skipping agent.\n\n`));
    return;
  }

  const stuckStep = playbook.steps[stuckAtIndex];
  log.warn(
    chalk.yellow(
      `\n  Replay stuck at step ${stuckAtIndex} (${stuckStep.tool}). Falling back to agent...\n\n`,
    ),
  );

  const taskList = createTaskList(eventSchemas);
  const agent = createConfiguredAgent(
    agentTools,
    schemaUrl,
    targetUrl,
    eventSchemas,
    "replay recovery after deterministic execution got stuck",
    () => accumulatedEvents,
    () => taskList,
    log,
  );
  const agentSteps: PlaybookStep[] = [];
  let recording = true;
  attachStepRecording(agent, agentSteps, () => recording);

  const baseSystemPrompt = createSystemPrompt();
  const credsSuffix = credentialsSummary ? "\n\n" + credentialsSummary : "";
  taskList.update(accumulatedEvents);
  agent.setSystemPrompt(baseSystemPrompt + "\n\n" + taskList.format() + credsSuffix);
  agent.setTools([...agentTools, createSkipTaskTool(taskList)]);
  attachTaskListDisplay(agent, taskList, accumulatedEvents, log);
  agent.subscribe((event) => {
    if (event.type === "turn_end") {
      taskList.update(accumulatedEvents);
      agent.setSystemPrompt(baseSystemPrompt + "\n\n" + taskList.format() + credsSuffix);
    }
  });

  await agent.prompt(
    `Replay got stuck at step ${stuckAtIndex} (${stuckStep.tool} — ${JSON.stringify(stuckStep.args)}). ` +
      `The browser is currently open. Please continue exploring to trigger any remaining expected events.\n\n` +
      buildInitialPrompt(schemaUrl, targetUrl, eventSchemas),
  );

  if (agentSteps.length === 0) return;

  recording = false;
  log.info(chalk.dim(`\n  Asking agent to optimize updated playbook...\n`));

  const combinedSteps = [
    ...playbook.steps.slice(0, stuckAtIndex),
    ...agentSteps,
  ];
  const rewriteText = await collectAgentText(
    agent,
    `The replay broke at step ${stuckAtIndex} and you recovered. ` +
      `Here are the combined steps (successful replay + your recovery):\n\n` +
      `\`\`\`json\n${JSON.stringify(combinedSteps, null, 2)}\n\`\`\`\n\n` +
      readPrompt("rewrite-playbook.md"),
  );
  const optimizedSteps = extractPlaybookSteps(rewriteText);
  const stepsToSave = optimizedSteps ?? combinedSteps;
  const source = optimizedSteps ? "optimized" : "combined";
  await savePlaybook(PLAYBOOK_FILE, {
    schemaUrl,
    targetUrl,
    steps: stepsToSave,
  }).catch(() => {
    /* non-fatal */
  });
  log.info(
    chalk.dim(
      `  Playbook updated (${stepsToSave.length} step(s), ${source}) — replay should work next time\n`,
    ),
  );
}

export async function runInteractiveMode(
  schemaUrl: string,
  targetUrl: string,
  eventSchemas: EventSchema[],
  savedMessages: unknown[],
  resume: boolean,
  agentTools: typeof allTools,
  accumulatedEvents: unknown[] = [],
  foundEventNames: string[] = [],
  skippedEvents: { name: string; reason: string }[] = [],
  credentialsSummary = "",
  log: Logger = createLogger(),
): Promise<void> {
  const taskList = createTaskList(eventSchemas);
  const baseSystemPrompt = createSystemPrompt();
  const credsSuffix = credentialsSummary ? "\n\n" + credentialsSummary : "";

  // Pre-populate task list from previous session so resume shows accurate state
  for (const name of foundEventNames) {
    taskList.update([{ event: name }]);
  }
  for (const { name, reason } of skippedEvents) {
    taskList.skip(name, reason);
  }

  const agent = createConfiguredAgent(
    agentTools,
    schemaUrl,
    targetUrl,
    eventSchemas,
    resume
      ? "resuming an unfinished agent-assisted session"
      : "exploring the site when deterministic execution is insufficient",
    () => accumulatedEvents,
    () => taskList,
    log,
  );
  agent.setSystemPrompt(baseSystemPrompt + "\n\n" + taskList.format() + credsSuffix);
  agent.setTools([...agentTools, createSkipTaskTool(taskList)]);
  const recordedSteps: PlaybookStep[] = [];
  let recording = true;
  attachStepRecording(agent, recordedSteps, () => recording);
  attachTaskListDisplay(agent, taskList, accumulatedEvents, log);

  agent.subscribe((event) => {
    if (event.type === "turn_end") {
      taskList.update(accumulatedEvents);
      agent.setSystemPrompt(baseSystemPrompt + "\n\n" + taskList.format() + credsSuffix);
    }
  });

  if (resume && savedMessages.length > 0) {
    agent.replaceMessages(
      savedMessages as Parameters<typeof agent.replaceMessages>[0],
    );
    await agent.prompt(
      `You are resuming a previous session. The browser has been re-opened at ${targetUrl}. ` +
        `Continue exploring to trigger any remaining expected events that you haven't covered yet.`,
    );
    return;
  }

  await agent.prompt(buildInitialPrompt(schemaUrl, targetUrl, eventSchemas));

  if (resume || recordedSteps.length === 0) return;

  recording = false;
  log.info(chalk.dim(`\n  Asking agent to optimize playbook...\n`));

  const rewriteText = await collectAgentText(
    agent,
    readPrompt("rewrite-playbook.md"),
  );
  const optimizedSteps = extractPlaybookSteps(rewriteText);
  const stepsToSave = optimizedSteps ?? recordedSteps;
  const source = optimizedSteps ? "optimized" : "raw";

  await savePlaybook(PLAYBOOK_FILE, {
    schemaUrl,
    targetUrl,
    steps: stepsToSave,
  }).catch(() => {
    /* non-fatal */
  });
  log.info(
    chalk.dim(
      `  Playbook saved (${stepsToSave.length} step(s), ${source}) → use --replay to replay\n`,
    ),
  );
}
