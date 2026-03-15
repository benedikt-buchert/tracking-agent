import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { getModel, getEnvApiKey } from "@mariozechner/pi-ai";
import type { AssistantMessage, KnownProvider } from "@mariozechner/pi-ai";
import chalk from "chalk";
import { allTools } from "./tools.js";

// ─── CLI argument parsing ─────────────────────────────────────────────────────

export interface CliArgs {
  schemaUrl: string;
  targetUrl: string;
}

export interface ParsedArgs {
  schemaUrl?: string;
  targetUrl?: string;
  help: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === "--schema") args["schema"] = argv[i + 1];
    if (argv[i] === "--url") args["url"] = argv[i + 1];
  }
  return { schemaUrl: args["schema"], targetUrl: args["url"], help: false };
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
    `    ${chalk.cyan("--help")}    Show this help message\n\n` +
    chalk.bold("  Environment\n") +
    `    ${chalk.cyan("MODEL_PROVIDER")}  AI provider (default: anthropic)\n` +
    `    ${chalk.cyan("MODEL_ID")}        Model ID (default: claude-opus-4-6)\n` +
    `    ${chalk.cyan("ANTHROPIC_API_KEY")} / ${chalk.cyan("OPENAI_API_KEY")}\n\n`
  );
}

export type PromptFn = (question: string) => Promise<string>;

export async function resolveArgs(argv: string[], prompt?: PromptFn): Promise<CliArgs | null> {
  const parsed = parseArgs(argv);
  if (parsed.help) return null;

  const ask: PromptFn = prompt ?? (async (q) => {
    const { createInterface } = await import("readline/promises");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(q);
    rl.close();
    return answer.trim();
  });

  const schemaUrl = parsed.schemaUrl ?? await ask(chalk.cyan("  Schema URL: "));
  const targetUrl = parsed.targetUrl ?? await ask(chalk.cyan("  Target URL: "));
  return { schemaUrl, targetUrl };
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

export function createSystemPrompt(): string {
  return `You are a tracking validation agent. Your job is to verify that a website's
dataLayer events conform to a JSON Schema specification.

## Workflow

1. **Discover all event schemas** — The schema URL is an entry point. Use fetch_schema
   to fetch it. It will contain \`$ref\` links (relative or absolute) to individual
   event schemas, typically inside a \`oneOf\` array. Resolve each \`$ref\` to an
   absolute URL using the entry-point's \`$id\` or URL as the base, then fetch each
   sub-schema with fetch_schema. Build a map of event name → absolute sub-schema URL.

2. **Navigate and explore** — Use browser_navigate to open the target URL. Use
   browser_snapshot to understand the page structure.

3. **Trigger interactions** — Click buttons, links, fill forms, and navigate between
   pages to trigger tracking events. Use browser_find, browser_click, browser_fill
   as needed. After each meaningful interaction, capture the dataLayer.

4. **Capture dataLayer events** — Use get_datalayer (with from_index to get only new
   events since your last capture) to read window.dataLayer after each interaction.

5. **Validate each event** — For every captured dataLayer event, look up its event
   name in your map and call validate_event with the event object and that event's
   specific sub-schema URL. If no specific sub-schema matches, fall back to the
   entry-point URL. Record whether it passed or failed.

6. **Report results** — When you have covered the main user interactions, produce a
   structured summary:
   - Total events captured
   - Events that passed validation (with event name and sub-schema used)
   - Events that failed validation (with event name and specific errors)
   - Any expected event types from the schemas that were NOT observed
   - Recommendations for fixing failures

## Rules

- Always resolve \`$ref\` values to absolute URLs before calling fetch_schema or
  validate_event. A relative ref like \`./web/purchase-event.json\` with base
  \`https://example.com/schemas/1.3.0/event-reference.json\` resolves to
  \`https://example.com/schemas/1.3.0/web/purchase-event.json\`.
- Always call get_datalayer with from_index set to the length of events you have
  already captured, so you only see new events.
- Validate EVERY event you capture — do not skip any.
- If the validator server is unreachable, note it and continue capturing events;
  report the raw events at the end so the user can validate manually.
- Be thorough: test page loads, clicks, form submissions, and navigation.`;
}

export function buildInitialPrompt(schemaUrl: string, targetUrl: string): string {
  return `Please validate the tracking implementation on the following website.

Schema entry point: ${schemaUrl}
Target URL:         ${targetUrl}

Start by fetching the entry-point schema and discovering all linked sub-schemas
(\`$ref\` entries in the \`oneOf\`). Resolve each to an absolute URL and fetch it
so you understand every expected event type. Then navigate the website, trigger
interactions, capture dataLayer events, and validate each event against its
specific sub-schema URL.`;
}

// ─── Console event handler ────────────────────────────────────────────────────

type WriteFn = (s: string) => void;

export function createConsoleHandler(
  write: WriteFn = (s) => { process.stdout.write(s); },
  writeErr: WriteFn = (s) => { process.stderr.write(s); },
): (event: AgentEvent) => void {
  return (event) => {
    if (event.type === "message_update") {
      const ame = event.assistantMessageEvent;
      if (ame.type === "text_delta") {
        write(ame.delta);
      }
    }
    if (event.type === "tool_execution_start") {
      writeErr(chalk.dim(`\n  ${chalk.cyan("▶")} ${event.toolName}\n`));
    }
    if (event.type === "turn_end" && (event.message as AssistantMessage).stopReason === "error") {
      const msg = (event.message as AssistantMessage).errorMessage ?? "Unknown error";
      const provider = process.env["MODEL_PROVIDER"] ?? "anthropic";
      const billingUrl = provider === "openai"
        ? "platform.openai.com/settings/billing"
        : "console.anthropic.com/plans";
      const hint = msg.toLowerCase().includes("credit") || msg.toLowerCase().includes("billing") || msg.toLowerCase().includes("quota")
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
  const provider = (process.env["MODEL_PROVIDER"] ?? "anthropic") as KnownProvider;
  const id = process.env["MODEL_ID"] ?? "claude-opus-4-6";
  // @ts-expect-error — provider/id are runtime strings; generic constraints can't be satisfied statically
  return getModel(provider, id);
}

export function checkApiKey(): void {
  const provider = process.env["MODEL_PROVIDER"] ?? "anthropic";
  const keyVar = provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  if (!process.env[keyVar]) {
    process.stderr.write(
      chalk.red(`\n✖ Missing ${keyVar} environment variable.\n`) +
      chalk.dim(`  Set it in your shell or in a .env file and run via: npm run dev\n\n`)
    );
    process.exit(1);
  }
}

export function createAgent(): Agent {
  const agent = new Agent({
    getApiKey: (provider) => getEnvApiKey(provider),
  });
  agent.setModel(resolveModel());
  agent.setSystemPrompt(createSystemPrompt());
  agent.setTools(allTools);
  return agent;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  const args = await resolveArgs(process.argv.slice(2));

  if (!args) {
    printHelp();
    return;
  }

  const { schemaUrl, targetUrl } = args;

  checkApiKey();

  process.stderr.write(
    chalk.bold("\n  Tracking Agent\n") +
    chalk.dim(`  Schema: ${schemaUrl}\n  Target: ${targetUrl}\n\n`)
  );

  const agent = createAgent();
  agent.subscribe(createConsoleHandler());
  await agent.prompt(buildInitialPrompt(schemaUrl, targetUrl));
}

