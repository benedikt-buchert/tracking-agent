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

  it("defines a husky pre-push hook that runs local verification", () => {
    const hookPath = join(ROOT, ".husky", "pre-push");
    expect(existsSync(hookPath)).toBe(true);

    const hook = readFileSync(hookPath, "utf8");
    expect(hook).toContain("npm run verify:local");
  });

  it("defines mutation-testing scripts and stryker config for deterministic core files", () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(pkg.scripts?.["test:mutation"]).toBe("stryker run");
    expect(pkg.scripts?.["test:mutation:file"]).toBe("stryker run --mutate");
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
      incremental?: boolean;
      incrementalFile?: string;
      coverageAnalysis?: string;
    };

    expect(config.testRunner).toBe("vitest");
    expect(config.checkers).toEqual(["typescript"]);
    expect(config.tsconfigFile).toBe("tsconfig.json");
    expect(config.mutate).toEqual(["src/**/*.ts", "!src/**/*.test.ts"]);
    expect(config.incremental).toBe(true);
    expect(config.incrementalFile).toBe("reports/stryker-incremental.json");
    expect(config.coverageAnalysis).toBe("perTest");
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

  it("defines a dedicated integration-test script and config", () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.["test:integration"]).toBe(
      "node --import tsx src/integration/run-suite.ts -- vitest run -c vitest.integration.config.ts",
    );
    expect(pkg.scripts?.["test:integration:llm"]).toBe(
      "node --import tsx src/integration/run-suite.ts -- vitest run -c vitest.integration.config.ts src/integration/agent-assisted.integration.test.ts",
    );
    expect(pkg.scripts?.["verify:local"]).toBe(
      "npm run verify && env -u AGENT_BROWSER_HEADED npm run test:integration && env -u AGENT_BROWSER_HEADED npm run test:integration:llm",
    );
    expect(pkg.scripts?.["verify:local:headed"]).toBe(
      "npm run verify && AGENT_BROWSER_HEADED=true npm run test:integration && AGENT_BROWSER_HEADED=true npm run test:integration:llm",
    );
    expect(existsSync(join(ROOT, "vitest.integration.config.ts"))).toBe(true);
    const defaultVitestConfig = readFileSync(
      join(ROOT, "vitest.config.ts"),
      "utf8",
    );
    expect(defaultVitestConfig).toContain("src/**/*.integration.test.ts");
  });

  it("defines CI workflows for quality and mutation testing", () => {
    const workflowPath = join(ROOT, ".github", "workflows", "quality.yml");
    expect(existsSync(workflowPath)).toBe(true);

    const workflow = readFileSync(workflowPath, "utf8");
    expect(workflow).toContain("npm run verify");
    expect(workflow).toContain("npm run test:crap");
    expect(workflow).not.toContain("test:integration");

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
    expect(mutationWorkflow).toContain("reports/stryker-incremental.json");
    expect(mutationWorkflow).toContain("actions/cache");
    expect(mutationWorkflow).not.toContain("test:integration");
  });

  it("defines demo hosting and local demo scripts", () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.["demo:serve"]).toBe(
      "node --import tsx src/integration/serve-demo.ts",
    );

    const workflowPath = join(ROOT, ".github", "workflows", "demo-pages.yml");
    expect(existsSync(workflowPath)).toBe(true);

    const workflow = readFileSync(workflowPath, "utf8");
    expect(workflow).toContain("actions/configure-pages");
    expect(workflow).toContain("actions/upload-pages-artifact");
    expect(workflow).toContain("actions/deploy-pages");
    expect(workflow).toContain("integration-site");
  });
});
