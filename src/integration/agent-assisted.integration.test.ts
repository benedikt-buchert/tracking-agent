import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "../agent/runtime.js";
import { buildInitialPrompt } from "../agent/prompts.js";
import { buildAgentTools } from "../agent/runtime.js";
import {
  captureDataLayer,
  closeBrowser,
  navigateTo,
  replayPlaybook,
  validateAll,
} from "../browser/runner.js";
import { createLocalFirstLoader } from "../validation/index.js";
import { discoverEventSchemas } from "../schema.js";
import {
  SCHEMA_URL,
  fixtureScenarios,
  startFixtureSiteServer,
} from "./site-fixture.js";

const shouldRun =
  process.env["RUN_LLM_INTEGRATION"] === "1" &&
  (!!process.env["ANTHROPIC_API_KEY"] ||
    !!process.env["OPENAI_API_KEY"] ||
    !!process.env["GOOGLE_CLOUD_API_KEY"] ||
    !!process.env["XAI_API_KEY"] ||
    !!process.env["GROQ_API_KEY"]);

const FIXTURES_SCHEMAS_DIR = join(import.meta.dirname, "fixtures");
const loadSchemaFn = createLocalFirstLoader(FIXTURES_SCHEMAS_DIR);

describe.skipIf(!shouldRun)("agent-assisted integration fixture", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (closers.length > 0) {
      await closers.pop()?.();
    }
    await closeBrowser().catch(() => {
      /* non-fatal */
    });
    delete process.env["AGENT_BROWSER_HEADED"];
  });

  it(
    "recovers on the mutated site after deterministic replay gets stuck",
    async () => {
      const server = await startFixtureSiteServer();
      closers.push(server.close);

      const deterministic = fixtureScenarios.find(
        (scenario) => scenario.name === "deterministic",
      );
      const mutated = fixtureScenarios.find(
        (scenario) => scenario.name === "mutated",
      );
      expect(deterministic).toBeDefined();
      expect(mutated).toBeDefined();

      const eventSchemas = await discoverEventSchemas(
        SCHEMA_URL,
        "web-datalayer-js",
      );
      const accumulatedEvents: unknown[] = [];
      const { tools } = buildAgentTools(accumulatedEvents, true);

      await navigateTo(`${server.baseUrl}${mutated!.route}`);

      const replayResult = await replayPlaybook(
        deterministic!.deterministicPlaybook,
        async (step) => {
          const tool = tools.find((candidate) => candidate.name === step.tool);
          if (!tool) throw new Error(`Missing tool ${step.tool}`);
          const result = await tool.execute("integration", step.args as never);
          return (result.content[0] as { text?: string }).text ?? "";
        },
      );

      expect(replayResult.stuckAtIndex).toBeGreaterThanOrEqual(0);

      const agent = createAgent("local integration recovery");
      agent.setTools(tools);
      await agent.prompt(
        `Replay got stuck on the mutated demo site. Continue from the current browser state and trigger the remaining expected events.\n\n` +
          buildInitialPrompt(
            SCHEMA_URL,
            `${server.baseUrl}${mutated!.route}`,
            eventSchemas,
          ),
      );

      const observedEvents = await captureDataLayer(0);
      const results = await validateAll(
        observedEvents,
        eventSchemas,
        SCHEMA_URL,
        loadSchemaFn,
      );

      const observedEventNames = new Set(
        results.map((result) => result.eventName).filter(Boolean),
      );
      expect(observedEventNames.has("purchase")).toBe(true);
      expect(observedEventNames.has("address_submitted")).toBe(true);
    },
    180_000,
  );
});
