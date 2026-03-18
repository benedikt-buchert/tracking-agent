import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import chalk from "chalk";

type WriteFn = (s: string) => void;
type ToolArgs = Record<string, unknown>;
type ToolSummaryFn = (args: ToolArgs) => string;

function stringArg(args: ToolArgs, ...keys: string[]): string {
  for (const key of keys) {
    const value = args[key];
    if (value !== undefined) return String(value);
  }
  return "";
}

const toolSummaryFormatters: Record<string, ToolSummaryFn> = {
  browser_navigate: (args) => stringArg(args, "url"),
  browser_click: (args) => stringArg(args, "selector", "text"),
  browser_fill: (args) =>
    `${stringArg(args, "selector")} = "${stringArg(args, "value", "text")}"`,
  browser_find: (args) =>
    `${stringArg(args, "locator")} "${stringArg(args, "value")}"`,
  browser_eval: (args) => stringArg(args, "expression", "js").slice(0, 60),
  browser_wait: (args) =>
    stringArg(args, "load", "selector", "target", "ms"),
  get_datalayer: (args) => `from index ${stringArg(args, "from_index") || "0"}`,
  request_human_input: (args) => stringArg(args, "message").slice(0, 80),
};

function toolArgSummary(toolName: string, args: ToolArgs): string {
  return toolSummaryFormatters[toolName]?.(args) ?? "";
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
      const detail = toolArgSummary(
        event.toolName,
        event.args as Record<string, unknown>,
      );
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
