export function isMutatableSourceFile(filePath: string): boolean {
  return (
    filePath.startsWith("src/") &&
    filePath.endsWith(".ts") &&
    !filePath.endsWith(".test.ts")
  );
}

export function selectMutationTargets(filePaths: string[]): string[] {
  return [...new Set(filePaths.filter(isMutatableSourceFile))].sort();
}

export function buildStrykerArgs(
  targets?: string[],
  options: { dryRunOnly?: boolean } = {},
): string[] {
  const args = ["run", "--coverageAnalysis", "off", "--concurrency", "1"];

  if (options.dryRunOnly) {
    args.push("--dryRunOnly");
  }

  if (targets !== undefined && targets.length > 0) {
    args.push("--mutate", targets.join(","));
  }

  return args;
}
