import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..", "..");

describe("project verification config", () => {
  it("defines prepare and verify scripts for husky-based verification", () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.["prepare"]).toBe("husky");
    expect(pkg.scripts?.["verify"]).toBe(
      "npm run lint && npm run test && npm run typecheck",
    );
  });

  it("defines a husky pre-commit hook that runs the verification command", () => {
    const hookPath = join(ROOT, ".husky", "pre-commit");
    expect(existsSync(hookPath)).toBe(true);

    const hook = readFileSync(hookPath, "utf8");
    expect(hook).toContain("npm run quality:staged");
  });

  it("defines mutation-testing scripts and stryker config for deterministic core files", () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(pkg.scripts?.["test:mutation"]).toBe("stryker run");
    expect(pkg.scripts?.["test:mutation:changed"]).toBe(
      "node --import tsx src/quality/mutation-run.ts --staged",
    );
    expect(pkg.devDependencies?.["@stryker-mutator/core"]).toBeTruthy();
    expect(
      pkg.devDependencies?.["@stryker-mutator/vitest-runner"],
    ).toBeTruthy();
    expect(
      pkg.devDependencies?.["@stryker-mutator/typescript-checker"],
    ).toBeTruthy();

    const configPath = join(ROOT, "stryker.config.json");
    expect(existsSync(configPath)).toBe(true);

    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      mutate?: string[];
      testRunner?: string;
      checkers?: string[];
      tsconfigFile?: string;
    };

    expect(config.testRunner).toBe("vitest");
    expect(config.checkers).toEqual(["typescript"]);
    expect(config.tsconfigFile).toBe("tsconfig.json");
    expect(config.mutate).toEqual(["src/**/*.ts", "!src/**/*.test.ts"]);
  });

  it("defines coverage and CRAP-report scripts", () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(pkg.scripts?.["test:coverage"]).toBe(
      "vitest run --coverage.enabled true --coverage.provider v8 --coverage.reporter json",
    );
    expect(pkg.scripts?.["quality:staged"]).toBe(
      "npm run lint && npm run test:coverage && npm run typecheck && node --import tsx src/quality/crap-report.ts --staged --threshold 30",
    );
    expect(pkg.scripts?.["test:crap"]).toBe(
      "npm run test:coverage && node --import tsx src/quality/crap-report.ts",
    );
    expect(pkg.devDependencies?.["@vitest/coverage-v8"]).toBeTruthy();
  });

  it("defines CI workflows for quality and mutation testing", () => {
    const workflowPath = join(ROOT, ".github", "workflows", "quality.yml");
    expect(existsSync(workflowPath)).toBe(true);

    const workflow = readFileSync(workflowPath, "utf8");
    expect(workflow).toContain("npm run verify");
    expect(workflow).toContain("npm run test:crap");

    const mutationWorkflowPath = join(
      ROOT,
      ".github",
      "workflows",
      "mutation.yml",
    );
    expect(existsSync(mutationWorkflowPath)).toBe(true);

    const mutationWorkflow = readFileSync(mutationWorkflowPath, "utf8");
    expect(mutationWorkflow).toContain("src/quality/mutation-run.ts --base");
    expect(mutationWorkflow).toContain("npm run test:mutation");
  });
});
