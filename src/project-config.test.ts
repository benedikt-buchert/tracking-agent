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
});
