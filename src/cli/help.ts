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
    `    ${chalk.cyan("--schemas-dir")}  Local directory of schema files (used instead of remote fetches)\n` +
    `    ${chalk.cyan("--resume")}  Resume a previous session from .tracking-agent-session.json\n` +
    `    ${chalk.cyan("--credentials")}  Path to a JSON file with credential fields (see docs)\n` +
    `    ${chalk.cyan("--headless")}  Run the browser in the background (no visible window)\n` +
    `    ${chalk.cyan("--quiet")}     Suppress all progress output (only errors and the final report)\n` +
    `    ${chalk.cyan("--verbose")}   Show detailed step-by-step progress\n` +
    `    ${chalk.cyan("--help")}      Show this help message\n\n` +
    chalk.bold("  Environment\n") +
    `    ${chalk.cyan("STAGEHAND_MODEL")}               Primary Stagehand model (required)\n` +
    `    ${chalk.cyan("STAGEHAND_PROJECT")}             GCP project for Vertex models\n` +
    `    ${chalk.cyan("STAGEHAND_LOCATION")}            Vertex location for STAGEHAND_MODEL\n` +
    `    ${chalk.cyan("STAGEHAND_AGENT_MODEL")}         Hybrid agent model override\n` +
    `    ${chalk.cyan("STAGEHAND_EXECUTION_MODEL")}     Hybrid execution model override\n` +
    `    ${chalk.cyan("STAGEHAND_AGENT_LOCATION")}      Vertex location for STAGEHAND_AGENT_MODEL\n` +
    `    ${chalk.cyan("STAGEHAND_EXECUTION_LOCATION")}  Vertex location for STAGEHAND_EXECUTION_MODEL\n` +
    `    ${chalk.cyan("GOOGLE_GENERATIVE_AI_API_KEY")}  Google model API key when using google/... models\n` +
    `    ${chalk.cyan("OPENAI_API_KEY")}                OpenAI API key when using openai/... models\n` +
    chalk.dim(`    Vertex auth: gcloud auth application-default login\n`) +
    `\n`
  );
}

export function printHelp(): void {
  process.stdout.write(buildHelpText());
}
