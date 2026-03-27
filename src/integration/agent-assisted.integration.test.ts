import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgent, hasVertexAdcCredentials } from "../agent/runtime.js";
import { buildInitialPrompt } from "../agent/prompts.js";
import { buildAgentTools } from "../agent/runtime.js";
import {
  closeBrowser,
  drainInterceptor,
  navigateTo,
  replayPlaybook,
  validateAll,
} from "../browser/runner.js";
import { createLocalFirstLoader } from "../validation/index.js";
import { discoverEventSchemas } from "../schema.js";
import {
  SCHEMA_URL,
  TEST_CREDENTIALS_PATH,
  fixtureScenarios,
  startFixtureSiteServer,
} from "./site-fixture.js";
import { loadCredentials, formatCredentialsSummary } from "../credentials.js";

const hasApiKey =
  !!process.env["ANTHROPIC_API_KEY"] ||
  !!process.env["OPENAI_API_KEY"] ||
  !!process.env["GOOGLE_CLOUD_API_KEY"] ||
  !!process.env["XAI_API_KEY"] ||
  !!process.env["GROQ_API_KEY"] ||
  (process.env["MODEL_PROVIDER"] === "google-vertex" && hasVertexAdcCredentials());

const shouldRun =
  process.env["RUN_LLM_INTEGRATION"] === "1" && hasApiKey;

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
      const credentialStore = await loadCredentials(TEST_CREDENTIALS_PATH);
      const accumulatedEvents: unknown[] = [];
      const { tools } = buildAgentTools(accumulatedEvents, true, undefined, credentialStore);

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

      const credentialsSummary = formatCredentialsSummary(credentialStore.fieldSummary());
      const agent = createAgent("local integration recovery");
      agent.setTools(tools);

      // Safety: abort after 50 tool calls to prevent infinite loops
      let toolCallCount = 0;
      const MAX_TOOL_CALLS = 50;
      agent.setAfterToolCall(async (ctx) => {
        toolCallCount++;
        process.stderr.write(`  [agent] tool ${toolCallCount}/${MAX_TOOL_CALLS}: ${ctx.toolCall.name}(${JSON.stringify(ctx.args).slice(0, 80)})\n`);
        if (toolCallCount >= MAX_TOOL_CALLS) {
          agent.abort();
        }
        return undefined;
      });

      await agent.prompt(
        `The deterministic replay got stuck because the site's DOM has changed (different testids and layout). ` +
          `The browser is still open on the page where replay failed.\n\n` +
          `**Start by taking a browser_snapshot** to see the current page state, then work through the site to trigger the remaining events. ` +
          `The site is a multi-step checkout flow: landing → checkout form → payment form → profile page. ` +
          `Use browser_find to discover the actual testids on each page. ` +
          `For sensitive payment fields (card number, CVC), use the fill_credential tool instead of browser_fill.\n\n` +
          credentialsSummary + "\n\n" +
          buildInitialPrompt(
            SCHEMA_URL,
            `${server.baseUrl}${mutated!.route}`,
            eventSchemas,
          ),
      );

      // Drain any remaining intercepted events into the accumulator
      const finalEvents = await drainInterceptor();
      accumulatedEvents.push(...finalEvents);

      const results = await validateAll(
        accumulatedEvents,
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
    300_000,
  );
});
