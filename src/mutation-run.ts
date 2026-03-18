import { execFileSync } from "node:child_process";
import { selectMutationTargets, buildStrykerArgs } from "./mutation.js";

interface MutationRunOptions {
  staged: boolean;
  baseRef?: string;
  headRef?: string;
  dryRunOnly: boolean;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const targets = resolveTargets(options);

  if (targets.length === 0) {
    process.stdout.write("No changed source files selected for mutation testing.\n");
    return;
  }

  const args = buildStrykerArgs(targets, { dryRunOnly: options.dryRunOnly });
  execFileSync("./node_modules/.bin/stryker", args, {
    stdio: "inherit",
  });
}

function parseArgs(argv: string[]): MutationRunOptions {
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

function resolveTargets(options: MutationRunOptions): string[] {
  if (options.baseRef !== undefined) {
    const headRef = options.headRef ?? "HEAD";
    return selectMutationTargets(
      gitOutput(["diff", "--name-only", `${options.baseRef}...${headRef}`]),
    );
  }

  if (options.staged) {
    return selectMutationTargets(
      gitOutput(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]),
    );
  }

  return [];
}

function gitOutput(args: string[]): string[] {
  return execFileSync("git", args, { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

main();
