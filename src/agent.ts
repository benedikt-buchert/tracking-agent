import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { homedir } from "os";
import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { getModel, getEnvApiKey } from "@mariozechner/pi-ai";
import type { AssistantMessage, KnownProvider } from "@mariozechner/pi-ai";
import chalk from "chalk";
import {
  allTools,
  createDataLayerInterceptor,
  createRequestHumanInputTool,
} from "./tools.js";
import type { EventSchema } from "./schema.js";
import { discoverEventSchemas } from "./schema.js";
import {
  getCurrentUrl,
  startHeadedBrowser,
  closeBrowser,
  navigateTo,
  drainInterceptor,
  waitForNavigation,
  validateAll,
  generateReport,
  saveSession,
  loadSession,
  isActionTool,
  replayPlaybook,
  savePlaybook,
  loadPlaybook,
  saveReportFolder,
  extractPlaybookSteps,
} from "./runner.js";
import type { AgentSession, PlaybookStep, StepExecutor } from "./runner.js";

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../prompts");

function readPrompt(name: string): string {
  return readFileSync(join(PROMPTS_DIR, name), "utf8").trim();
}

// ─── CLI argument parsing ─────────────────────────────────────────────────────

export interface CliArgs {
  schemaUrl: string;
  targetUrl: string;
  resume: boolean;
  replay: boolean;
  headless: boolean;
}

export interface ParsedArgs {
  schemaUrl?: string;
  targetUrl?: string;
  resume: boolean;
  replay: boolean;
  headless: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.includes("--help") || argv.includes("-h"))
    return { help: true, resume: false, replay: false, headless: false };
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === "--schema") args["schema"] = argv[i + 1];
    if (argv[i] === "--url") args["url"] = argv[i + 1];
  }
  const resume = argv.includes("--resume");
  const replay = argv.includes("--replay");
  const headless = argv.includes("--headless");
  return {
    schemaUrl: args["schema"],
    targetUrl: args["url"],
    resume,
    replay,
    headless,
    help: false,
  };
}

export function printHelp(): void {
  process.stdout.write(
    chalk.bold("\n  tracking-agent\n\n") +
      "  Validates a website's dataLayer events against a JSON Schema.\n\n" +
      chalk.bold("  Usage\n") +
      `    tracking-agent ${chalk.cyan("--schema")} <url> ${chalk.cyan("--url")} <url>\n\n` +
      chalk.bold("  Options\n") +
      `    ${chalk.cyan("--schema")}  URL of the JSON Schema to validate against\n` +
      `    ${chalk.cyan("--url")}     URL of the website to test\n` +
      `    ${chalk.cyan("--resume")}  Resume a previous session from .tracking-agent-session.json\n` +
      `    ${chalk.cyan("--replay")}    Replay recorded steps from .tracking-agent-playbook.json (LLM fallback on failure)\n` +
      `    ${chalk.cyan("--headless")}  Run the browser in the background (no visible window)\n` +
      `    ${chalk.cyan("--help")}      Show this help message\n\n` +
      chalk.bold("  Environment\n") +
      `    ${chalk.cyan("MODEL_PROVIDER")}         AI provider (default: anthropic)\n` +
      `    ${chalk.cyan("MODEL_ID")}               Model ID (default: claude-opus-4-6)\n` +
      `    ${chalk.cyan("ANTHROPIC_API_KEY")}       For anthropic provider\n` +
      `    ${chalk.cyan("OPENAI_API_KEY")}          For openai provider\n` +
      `    ${chalk.cyan("GOOGLE_CLOUD_PROJECT")}    For google-vertex provider\n` +
      `    ${chalk.cyan("GOOGLE_CLOUD_LOCATION")}   For google-vertex provider\n` +
      chalk.dim(
        `    Google Vertex auth: gcloud auth application-default login\n`,
      ) +
      `\n`,
  );
}

export type PromptFn = (question: string) => Promise<string>;
export type ReadFileFn = (path: string) => Promise<string>;

export async function resolveArgs(
  argv: string[],
  prompt?: PromptFn,
  readFileFn?: ReadFileFn,
): Promise<CliArgs | null> {
  const parsed = parseArgs(argv);
  if (parsed.help) return null;

  const ask: PromptFn =
    prompt ??
    (async (q) => {
      const { createInterface } = await import("readline/promises");
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const answer = await rl.question(q);
      rl.close();
      return answer.trim();
    });

  const readFile: ReadFileFn =
    readFileFn ??
    (async (p) => {
      const { readFile: fsReadFile } = await import("fs/promises");
      return fsReadFile(p, "utf8");
    });

  // For replay/resume, load schema+url from saved files if not provided on CLI
  if (
    (parsed.replay || parsed.resume) &&
    (!parsed.schemaUrl || !parsed.targetUrl)
  ) {
    const savedFile = parsed.replay
      ? ".tracking-agent-playbook.json"
      : ".tracking-agent-session.json";
    try {
      const saved = JSON.parse(await readFile(savedFile)) as {
        schemaUrl?: string;
        targetUrl?: string;
      };
      const schemaUrl =
        parsed.schemaUrl ??
        saved.schemaUrl ??
        (await ask(chalk.cyan("  Schema URL: ")));
      const targetUrl =
        parsed.targetUrl ??
        saved.targetUrl ??
        (await ask(chalk.cyan("  Target URL: ")));
      return {
        schemaUrl,
        targetUrl,
        resume: parsed.resume,
        replay: parsed.replay,
        headless: parsed.headless,
      };
    } catch {
      // fall through to interactive prompt
    }
  }

  if (parsed.headless && (!parsed.schemaUrl || !parsed.targetUrl)) {
    process.stderr.write(
      chalk.red(
        "  ✖ --headless requires --schema and --url (or a saved playbook/session file)\n\n",
      ),
    );
    return null;
  }

  const schemaUrl =
    parsed.schemaUrl ?? (await ask(chalk.cyan("  Schema URL: ")));
  const targetUrl =
    parsed.targetUrl ?? (await ask(chalk.cyan("  Target URL: ")));
  return {
    schemaUrl,
    targetUrl,
    resume: parsed.resume,
    replay: parsed.replay,
    headless: parsed.headless,
  };
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

export function createSystemPrompt(): string {
  return readPrompt("system.md");
}

export function buildInitialPrompt(
  schemaUrl: string,
  targetUrl: string,
  eventSchemas: EventSchema[],
): string {
  const schemasText = eventSchemas
    .map(
      (s) =>
        `- ${s.eventName}${s.description ? ` — ${s.description}` : ""}\n  Schema: ${s.schemaUrl}`,
    )
    .join("\n");
  return readPrompt("initial.md")
    .replace("{{schemaUrl}}", schemaUrl)
    .replace("{{targetUrl}}", targetUrl)
    .replace("{{eventSchemas}}", schemasText);
}

// ─── Console event handler ────────────────────────────────────────────────────

type WriteFn = (s: string) => void;

function toolArgSummary(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case "browser_navigate":
      return String(args["url"] ?? "");
    case "browser_click":
      return String(args["selector"] ?? args["text"] ?? "");
    case "browser_fill":
      return `${String(args["selector"] ?? "")} = "${String(args["value"] ?? args["text"] ?? "")}"`;
    case "browser_find":
      return `${String(args["locator"] ?? "")} "${String(args["value"] ?? "")}"`;
    case "browser_eval":
      return String(args["expression"] ?? args["js"] ?? "").slice(0, 60);
    case "browser_wait":
      return String(
        args["load"] ?? args["selector"] ?? args["target"] ?? args["ms"] ?? "",
      );
    case "get_datalayer":
      return `from index ${String(args["from_index"] ?? 0)}`;
    case "request_human_input":
      return String(args["message"] ?? "").slice(0, 80);
    default:
      return "";
  }
}

export function createConsoleHandler(
  write: WriteFn = (s) => {
    process.stdout.write(s);
  },
  writeErr: WriteFn = (s) => {
    process.stderr.write(s);
  },
): (event: AgentEvent) => void {
  return (event) => {
    if (event.type === "message_update") {
      const ame = event.assistantMessageEvent;
      if (ame.type === "text_delta") {
        write(ame.delta);
      }
    }
    if (event.type === "tool_execution_start") {
      const args = event.args as Record<string, unknown>;
      const detail = toolArgSummary(event.toolName, args);
      writeErr(
        chalk.dim(
          `\n  ${chalk.cyan("▶")} ${event.toolName}${detail ? chalk.dim(` — ${detail}`) : ""}\n`,
        ),
      );
    }
    if (
      event.type === "turn_end" &&
      (event.message as AssistantMessage).stopReason === "error"
    ) {
      const msg =
        (event.message as AssistantMessage).errorMessage ?? "Unknown error";
      const provider = process.env["MODEL_PROVIDER"] ?? "anthropic";
      const billingUrl =
        provider === "openai"
          ? "platform.openai.com/settings/billing"
          : "console.anthropic.com/plans";
      const hint =
        msg.toLowerCase().includes("credit") ||
        msg.toLowerCase().includes("billing") ||
        msg.toLowerCase().includes("quota")
          ? chalk.yellow(`\n  Hint: Add credits at ${billingUrl}`)
          : "";
      writeErr(`\n${chalk.red("✖ Agent error:")} ${msg}${hint}\n`);
    }
    if (event.type === "agent_end") {
      write("\n");
    }
  };
}

// ─── Agent factory ────────────────────────────────────────────────────────────

export function resolveModel() {
  const provider = (process.env["MODEL_PROVIDER"] ??
    "anthropic") as KnownProvider;
  const id = process.env["MODEL_ID"] ?? "claude-opus-4-6";
  // @ts-expect-error — provider/id are runtime strings; generic constraints can't be satisfied statically
  return getModel(provider, id);
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

function hasVertexAdcCredentials(): boolean {
  const gacPath = process.env["GOOGLE_APPLICATION_CREDENTIALS"];
  if (gacPath) return existsSync(gacPath);
  return existsSync(
    join(
      homedir(),
      ".config",
      "gcloud",
      "application_default_credentials.json",
    ),
  );
}

export function checkApiKey(): void {
  const provider = process.env["MODEL_PROVIDER"] ?? "anthropic";

  if (provider === "google-vertex") {
    const hasCredentials = process.env["GOOGLE_CLOUD_API_KEY"]
      ? true
      : hasVertexAdcCredentials();
    const hasProject = !!(
      process.env["GOOGLE_CLOUD_PROJECT"] ?? process.env["GCLOUD_PROJECT"]
    );
    const hasLocation = !!process.env["GOOGLE_CLOUD_LOCATION"];
    if (hasCredentials && hasProject && hasLocation) return;

    const missing: string[] = [];
    if (!hasProject) missing.push("GOOGLE_CLOUD_PROJECT");
    if (!hasLocation) missing.push("GOOGLE_CLOUD_LOCATION");
    throw new ConfigurationError(
      chalk.red(`\n✖ Google Vertex AI is not fully configured.\n`) +
        (missing.length > 0
          ? chalk.dim(`  Missing env vars: ${missing.join(", ")}\n`)
          : chalk.dim(`  ADC credentials not found.\n`)) +
        chalk.dim(`  Run: gcloud auth application-default login\n`) +
        chalk.dim(
          `  Then set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION in your .env\n\n`,
        ),
    );
  }

  const key = getEnvApiKey(provider);
  if (key) return;

  const keyVarMap: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GEMINI_API_KEY",
    groq: "GROQ_API_KEY",
    xai: "XAI_API_KEY",
  };
  const keyVar =
    keyVarMap[provider] ??
    `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
  throw new ConfigurationError(
    chalk.red(`\n✖ Missing ${keyVar} environment variable.\n`) +
      chalk.dim(`  Set it in your shell or in a .env file.\n\n`),
  );
}

export function createAgent(purpose = "agent-assisted exploration"): Agent {
  try {
    checkApiKey();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw new ConfigurationError(
        chalk.yellow(`\nLLM assistance is required for ${purpose}.\n`) +
          chalk.dim(
            `Deterministic execution has reached a step that needs the model.\n`,
          ) +
          error.message,
      );
    }
    throw error;
  }
  const agent = new Agent({
    // For google-vertex with ADC, return undefined so pi-ai uses project/location + ADC
    // rather than treating the "<authenticated>" sentinel as a literal API key.
    getApiKey: (provider) => {
      const key = getEnvApiKey(provider);
      return key === "<authenticated>" ? undefined : key;
    },
  });
  agent.setModel(resolveModel());
  agent.setSystemPrompt(createSystemPrompt());
  agent.setTools(allTools);
  return agent;
}

// ─── buildAgentTools ──────────────────────────────────────────────────────────

const POLLED_TOOL_NAMES = new Set([
  "browser_navigate",
  "browser_click",
  "browser_fill",
  "browser_find",
  "browser_wait",
  "request_human_input",
]);

export function buildAgentTools(
  accumulatedEvents: unknown[],
  headless: boolean,
): { tools: typeof allTools } {
  const intercept = createDataLayerInterceptor(accumulatedEvents);
  const headlessHumanInputTool = headless
    ? createRequestHumanInputTool(
        () => Promise.resolve(""),
        () => {},
      )
    : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools = allTools
    .filter((t) => t.name !== "get_datalayer")
    .map((t) => {
      if (headlessHumanInputTool && t.name === "request_human_input")
        return headlessHumanInputTool;
      if (POLLED_TOOL_NAMES.has(t.name)) return intercept(t);
      return t;
    }) as typeof allTools;
  return { tools };
}

// ─── collectAgentText ─────────────────────────────────────────────────────────

export async function collectAgentText(
  agent: Agent,
  prompt: string,
): Promise<string> {
  let text = "";
  agent.subscribe((event: AgentEvent) => {
    if (event.type === "message_update") {
      const ame = event.assistantMessageEvent;
      if (ame.type === "text_delta") text += ame.delta;
    }
  });
  await agent.prompt(prompt).catch(() => {});
  return text;
}

// ─── Step executor for replay ─────────────────────────────────────────────────

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

// ─── Entry point ─────────────────────────────────────────────────────────────

const SESSION_FILE = ".tracking-agent-session.json";
const PLAYBOOK_FILE = ".tracking-agent-playbook.json";

async function loadRunState(
  schemaUrl: string,
  resume: boolean,
): Promise<{ eventSchemas: EventSchema[]; savedMessages: unknown[] }> {
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
    };
  }

  process.stderr.write(
    chalk.dim(`  Discovering schemas from ${schemaUrl}...\n`),
  );
  const eventSchemas = await discoverEventSchemas(
    schemaUrl,
    "web-datalayer-js",
  );
  process.stderr.write(
    chalk.dim(`  Found ${eventSchemas.length} event schema(s)\n\n`),
  );
  return { eventSchemas, savedMessages: [] };
}

async function openBrowser(
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

async function captureFinalEvents(
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

async function runReplayMode(
  schemaUrl: string,
  targetUrl: string,
  eventSchemas: EventSchema[],
  agentTools: typeof allTools,
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

async function runInteractiveMode(
  schemaUrl: string,
  targetUrl: string,
  eventSchemas: EventSchema[],
  savedMessages: unknown[],
  resume: boolean,
  agentTools: typeof allTools,
): Promise<void> {
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

export async function main(): Promise<void> {
  const args = await resolveArgs(process.argv.slice(2));

  if (!args) {
    printHelp();
    return;
  }

  const { schemaUrl, targetUrl, resume, replay, headless } = args;

  const mode = replay ? "replay" : resume ? "resume" : "fresh";
  process.stderr.write(
    chalk.bold("\n  Tracking Agent\n") +
      chalk.dim(`  Schema: ${schemaUrl}\n  Target: ${targetUrl}\n`) +
      (mode !== "fresh" ? chalk.dim(`  Mode: ${mode}\n`) : "") +
      (headless ? chalk.dim(`  Browser: headless\n`) : "") +
      "\n",
  );

  const { eventSchemas, savedMessages } = await loadRunState(schemaUrl, resume);
  await openBrowser(targetUrl, headless);

  // Accumulator — collects all dataLayer events across all pages
  const accumulatedEvents: unknown[] = [];
  // Install interceptor on the landing page and capture any events already there
  const landingEvents = await drainInterceptor();
  accumulatedEvents.push(...landingEvents);
  // In headless mode request_human_input auto-continues; accumulating tool tracks all events
  const { tools: agentTools } = buildAgentTools(accumulatedEvents, headless);

  if (replay) {
    await runReplayMode(schemaUrl, targetUrl, eventSchemas, agentTools);
  } else {
    await runInteractiveMode(
      schemaUrl,
      targetUrl,
      eventSchemas,
      savedMessages,
      resume,
      agentTools,
    );
  }

  const events = await captureFinalEvents(accumulatedEvents);

  // Step 5: Validate all events (code)
  process.stderr.write(chalk.dim(`  Validating events...\n`));
  const results = await validateAll(events, eventSchemas, schemaUrl);

  // Step 6: Generate and print report (code)
  const expectedNames = eventSchemas.map((s) => s.eventName);
  const report = generateReport(results, expectedNames, events, eventSchemas);
  process.stdout.write(report);

  // Step 7: Save report folder
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

  // Step 8: Close the browser
  await closeBrowser();
}
