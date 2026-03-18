import chalk from "chalk";

export function buildHelpText(): string {
  return (
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
    `\n`
  );
}

export function printHelp(): void {
  process.stdout.write(buildHelpText());
}
