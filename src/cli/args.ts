import chalk from "chalk";

interface CliArgs {
  schemaUrl: string;
  targetUrl: string;
  headless: boolean;
  quiet: boolean;
  verbose: boolean;
  schemasDir?: string;
  credentials?: string;
  cacheDir?: string;
}

interface ParsedArgs {
  schemaUrl?: string;
  targetUrl?: string;
  headless: boolean;
  quiet: boolean;
  verbose: boolean;
  help: boolean;
  schemasDir?: string;
  credentials?: string;
  cacheDir?: string;
}

type PromptFn = (question: string) => Promise<string>;

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.includes("--help") || argv.includes("-h"))
    return {
      help: true,
      headless: false,
      quiet: false,
      verbose: false,
    };
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === "--schema") args["schema"] = argv[i + 1];
    if (argv[i] === "--url") args["url"] = argv[i + 1];
    if (argv[i] === "--schemas-dir") args["schemas-dir"] = argv[i + 1];
    if (argv[i] === "--credentials") args["credentials"] = argv[i + 1];
    if (argv[i] === "--cache-dir") args["cache-dir"] = argv[i + 1];
  }
  const headless = argv.includes("--headless");
  const quiet = argv.includes("--quiet");
  const verbose = argv.includes("--verbose");
  return {
    schemaUrl: args["schema"],
    targetUrl: args["url"],
    schemasDir: args["schemas-dir"],
    credentials: args["credentials"],
    cacheDir: args["cache-dir"] ?? ".cache",
    headless,
    quiet,
    verbose,
    help: false,
  };
}

function createPrompt(prompt?: PromptFn): PromptFn {
  if (prompt) return prompt;

  return async (question) => {
    const { createInterface } = await import("readline/promises");
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await rl.question(question);
    rl.close();
    return answer.trim();
  };
}

export async function resolveArgs(
  argv: string[],
  prompt?: PromptFn,
): Promise<CliArgs | null> {
  const parsed = parseArgs(argv);
  if (parsed.help) return null;

  const ask = createPrompt(prompt);

  if (parsed.headless && (!parsed.schemaUrl || !parsed.targetUrl)) {
    process.stderr.write(
      chalk.red(
        "  ✖ --headless requires --schema and --url\n\n",
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
    headless: parsed.headless,
    quiet: parsed.quiet,
    verbose: parsed.verbose,
    schemasDir: parsed.schemasDir,
    credentials: parsed.credentials,
    cacheDir: parsed.cacheDir,
  };
}
