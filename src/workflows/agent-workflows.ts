import type { Agent } from "@mariozechner/pi-agent-core";
import chalk from "chalk";
import type { allTools } from "../browser/tools.js";
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
import { PLAYBOOK_FILE, SESSION_FILE } from "./runtime.js";

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
): void {
  agent.subscribe(async (event) => {
    if (event.type === "turn_end") {
      const session: AgentSession = {
        schemaUrl,
        targetUrl,
        eventSchemas,
        messages: agent.state.messages,
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
): Agent {
  const agent = createAgent(purpose);
  agent.setTools(agentTools);
  attachSessionPersistence(agent, schemaUrl, targetUrl, eventSchemas);
  agent.subscribe(createConsoleHandler());
  return agent;
}

export async function runReplayMode(
  schemaUrl: string,
  targetUrl: string,
  eventSchemas: EventSchema[],
  agentTools: typeof allTools,
  accumulatedEvents: unknown[] = [],
): Promise<void> {
  process.stderr.write(
    chalk.dim(`  Loading playbook from ${PLAYBOOK_FILE}...\n`),
  );
  const playbook = await loadPlaybook(PLAYBOOK_FILE);
  process.stderr.write(
    chalk.dim(`  Replaying ${playbook.steps.length} step(s)...\n\n`),
  );

  const executor = makeStepExecutor(agentTools);
  const { stuckAtIndex } = await replayPlaybook(playbook.steps, executor);

  if (stuckAtIndex === -1) {
    process.stderr.write(
      chalk.dim(
        `\n  Replay complete — all steps succeeded, skipping agent.\n\n`,
      ),
    );
    return;
  }

  const stuckStep = playbook.steps[stuckAtIndex];
  process.stderr.write(
    chalk.yellow(
      `\n  Replay stuck at step ${stuckAtIndex} (${stuckStep.tool}). Falling back to agent...\n\n`,
    ),
  );

  const agent = createConfiguredAgent(
    agentTools,
    schemaUrl,
    targetUrl,
    eventSchemas,
    "replay recovery after deterministic execution got stuck",
  );
  const agentSteps: PlaybookStep[] = [];
  let recording = true;
  attachStepRecording(agent, agentSteps, () => recording);

  const taskList = createTaskList(eventSchemas);
  const baseSystemPrompt = createSystemPrompt();
  taskList.update(accumulatedEvents);
  agent.setSystemPrompt(baseSystemPrompt + "\n\n" + taskList.format());
  agent.subscribe((event) => {
    if (event.type === "turn_end") {
      taskList.update(accumulatedEvents);
      agent.setSystemPrompt(baseSystemPrompt + "\n\n" + taskList.format());
    }
  });

  await agent.prompt(
    `Replay got stuck at step ${stuckAtIndex} (${stuckStep.tool} — ${JSON.stringify(stuckStep.args)}). ` +
      `The browser is currently open. Please continue exploring to trigger any remaining expected events.\n\n` +
      buildInitialPrompt(schemaUrl, targetUrl, eventSchemas),
  );

  if (agentSteps.length === 0) return;

  recording = false;
  process.stderr.write(
    chalk.dim(`\n  Asking agent to optimize updated playbook...\n`),
  );

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
  process.stderr.write(
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
): Promise<void> {
  const taskList = createTaskList(eventSchemas);
  const baseSystemPrompt = createSystemPrompt();

  const agent = createConfiguredAgent(
    agentTools,
    schemaUrl,
    targetUrl,
    eventSchemas,
    resume
      ? "resuming an unfinished agent-assisted session"
      : "exploring the site when deterministic execution is insufficient",
  );
  const recordedSteps: PlaybookStep[] = [];
  let recording = true;
  attachStepRecording(agent, recordedSteps, () => recording);

  agent.subscribe((event) => {
    if (event.type === "turn_end") {
      taskList.update(accumulatedEvents);
      agent.setSystemPrompt(baseSystemPrompt + "\n\n" + taskList.format());
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
  process.stderr.write(chalk.dim(`\n  Asking agent to optimize playbook...\n`));

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
  process.stderr.write(
    chalk.dim(
      `  Playbook saved (${stepsToSave.length} step(s), ${source}) → use --replay to replay\n`,
    ),
  );
}
