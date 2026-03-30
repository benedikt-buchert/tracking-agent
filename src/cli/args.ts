import chalk from "chalk";

interface CliArgs {
  schemaUrl: string;
  targetUrl: string;
  resume: boolean;
  replay: boolean;
  headless: boolean;
  quiet: boolean;
  verbose: boolean;
  schemasDir?: string;
  credentials?: string;
}

interface ParsedArgs {
  schemaUrl?: string;
  targetUrl?: string;
  resume: boolean;
  replay: boolean;
  headless: boolean;
  quiet: boolean;
  verbose: boolean;
  help: boolean;
  schemasDir?: string;
  credentials?: string;
}

type PromptFn = (question: string) => Promise<string>;
type ReadFileFn = (path: string) => Promise<string>;

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.includes("--help") || argv.includes("-h"))
    return {
      help: true,
      resume: false,
      replay: false,
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
  }
  const resume = argv.includes("--resume");
  const replay = argv.includes("--replay");
  const headless = argv.includes("--headless");
  const quiet = argv.includes("--quiet");
  const verbose = argv.includes("--verbose");
  return {
    schemaUrl: args["schema"],
    targetUrl: args["url"],
    schemasDir: args["schemas-dir"],
    credentials: args["credentials"],
    resume,
    replay,
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

function createReadFile(readFileFn?: ReadFileFn): ReadFileFn {
  if (readFileFn) return readFileFn;

  return async (path) => {
    const { readFile } = await import("fs/promises");
    return readFile(path, "utf8");
  };
}

function savedArgsFile(parsed: ParsedArgs): string | null {
  if (parsed.replay) return ".tracking-agent-playbook.json";
  if (parsed.resume) return ".tracking-agent-session.json";
  return null;
}

async function resolveSavedArgs(
  parsed: ParsedArgs,
  ask: PromptFn,
  readFile: ReadFileFn,
): Promise<CliArgs | null> {
  const savedFile = savedArgsFile(parsed);
  if (savedFile === null || (parsed.schemaUrl && parsed.targetUrl)) return null;

  try {
    const saved = JSON.parse(await readFile(savedFile)) as {
      schemaUrl?: string;
      targetUrl?: string;
    };
    return {
      schemaUrl:
        parsed.schemaUrl ??
        saved.schemaUrl ??
        (await ask(chalk.cyan("  Schema URL: "))),
      targetUrl:
        parsed.targetUrl ??
        saved.targetUrl ??
        (await ask(chalk.cyan("  Target URL: "))),
      resume: parsed.resume,
      replay: parsed.replay,
      headless: parsed.headless,
      quiet: parsed.quiet,
      verbose: parsed.verbose,
      schemasDir: parsed.schemasDir,
      credentials: parsed.credentials,
    };
  } catch {
    return null;
  }
}

export async function resolveArgs(
  argv: string[],
  prompt?: PromptFn,
  readFileFn?: ReadFileFn,
): Promise<CliArgs | null> {
  const parsed = parseArgs(argv);
  if (parsed.help) return null;

  const ask = createPrompt(prompt);
  const readFile = createReadFile(readFileFn);
  const savedArgs = await resolveSavedArgs(parsed, ask, readFile);
  if (savedArgs) return savedArgs;

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
    quiet: parsed.quiet,
    verbose: parsed.verbose,
    schemasDir: parsed.schemasDir,
    credentials: parsed.credentials,
  };
}
