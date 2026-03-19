import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { getModel, getEnvApiKey } from "@mariozechner/pi-ai";
import type { KnownProvider } from "@mariozechner/pi-ai";
import chalk from "chalk";
import {
  allTools,
  createDataLayerInterceptor,
  createRequestHumanInputTool,
} from "../browser/tools.js";
import { createSystemPrompt } from "./prompts.js";

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

export function hasVertexAdcCredentials(
  existsSyncFn: typeof existsSync = existsSync,
  homeDir: string = homedir(),
): boolean {
  const gacPath = process.env["GOOGLE_APPLICATION_CREDENTIALS"];
  if (gacPath) return existsSyncFn(gacPath);
  return existsSyncFn(
    join(homeDir, ".config", "gcloud", "application_default_credentials.json"),
  );
}

function getProvider(): string {
  return process.env["MODEL_PROVIDER"] ?? "anthropic";
}

function getMissingApiKeyVar(provider: string): string {
  const keyVarMap: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GEMINI_API_KEY",
    groq: "GROQ_API_KEY",
    xai: "XAI_API_KEY",
  };

  return (
    keyVarMap[provider] ??
    `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`
  );
}

function ensureVertexConfiguration(): void {
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

  const detail =
    missing.length > 0
      ? chalk.dim(`  Missing env vars: ${missing.join(", ")}\n`)
      : chalk.dim(`  ADC credentials not found.\n`);

  throw new ConfigurationError(
    chalk.red(`\n✖ Google Vertex AI is not fully configured.\n`) +
      detail +
      chalk.dim(`  Run: gcloud auth application-default login\n`) +
      chalk.dim(
        `  Then set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION in your .env\n\n`,
      ),
  );
}

function ensureProviderApiKey(provider: string): void {
  const key = getEnvApiKey(provider);
  if (key) return;

  const keyVar = getMissingApiKeyVar(provider);
  throw new ConfigurationError(
    chalk.red(`\n✖ Missing ${keyVar} environment variable.\n`) +
      chalk.dim(`  Set it in your shell or in a .env file.\n\n`),
  );
}

export function checkApiKey(): void {
  const provider = getProvider();
  if (provider === "google-vertex") {
    ensureVertexConfiguration();
    return;
  }
  ensureProviderApiKey(provider);
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
