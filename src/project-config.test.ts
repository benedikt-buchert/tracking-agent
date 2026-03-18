import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..");

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
    expect(hook).toContain("npm run verify");
  });

  it("defines mutation-testing scripts and stryker config for deterministic core files", () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(pkg.scripts?.["test:mutation"]).toBe("stryker run");
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
    expect(config.mutate).toEqual(["src/schema.ts"]);
  });
});
