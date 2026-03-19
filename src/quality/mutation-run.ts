import { execFileSync } from "node:child_process";
import { selectMutationTargets, buildStrykerArgs } from "./mutation.js";

interface MutationRunOptions {
  staged: boolean;
  baseRef?: string;
  headRef?: string;
  dryRunOnly: boolean;
}

type ExecFileSyncFn = typeof execFileSync;
type WriteFn = (text: string) => void;

interface MutationRunDependencies {
  execFileSyncFn: ExecFileSyncFn;
  write: WriteFn;
}

const defaultDependencies: MutationRunDependencies = {
  execFileSyncFn: execFileSync,
  write: (text) => {
    process.stdout.write(text);
  },
};

export function runMutationCommand(
  argv: string[],
  dependencies: MutationRunDependencies = defaultDependencies,
): void {
  const options = parseArgs(argv);
  const targets = resolveTargets(options, dependencies.execFileSyncFn);

  if (targets.length === 0) {
    dependencies.write(
      "No changed source files selected for mutation testing.\n",
    );
    return;
  }

  const args = buildStrykerArgs(targets, { dryRunOnly: options.dryRunOnly });
  dependencies.execFileSyncFn("./node_modules/.bin/stryker", args, {
    stdio: "inherit",
  });
}

export function parseArgs(argv: string[]): MutationRunOptions {
  const options: MutationRunOptions = {
    staged: false,
    dryRunOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--staged") {
      options.staged = true;
    } else if (arg === "--base") {
      options.baseRef = argv[index + 1];
      index += 1;
    } else if (arg === "--head") {
      options.headRef = argv[index + 1];
      index += 1;
    } else if (arg === "--dry-run-only") {
      options.dryRunOnly = true;
    }
  }

  return options;
}

export function resolveTargets(
  options: MutationRunOptions,
  execFileSyncFn: ExecFileSyncFn = execFileSync,
): string[] {
  if (options.baseRef !== undefined) {
    const headRef = options.headRef ?? "HEAD";
    return selectMutationTargets(
      gitOutput(
        ["diff", "--name-only", `${options.baseRef}...${headRef}`],
        execFileSyncFn,
      ),
    );
  }

  if (options.staged) {
    return selectMutationTargets(
      gitOutput(
        ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
        execFileSyncFn,
      ),
    );
  }

  return [];
}

export function gitOutput(
  args: string[],
  execFileSyncFn: ExecFileSyncFn = execFileSync,
): string[] {
  return execFileSyncFn("git", args, { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function main(): void {
  runMutationCommand(process.argv.slice(2));
}

if (process.env["VITEST"] !== "true") {
  main();
}
