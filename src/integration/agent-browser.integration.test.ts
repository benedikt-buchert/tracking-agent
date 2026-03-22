import { join } from "path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildAgentTools } from "../agent/runtime.js";
import {
  captureDataLayer,
  closeBrowser,
  drainInterceptor,
  navigateTo,
  replayPlaybook,
  validateAll,
} from "../browser/runner.js";
import type { BrowserFn } from "../browser/runner.js";
import { createLocalFirstLoader } from "../validation/index.js";
import { discoverEventSchemas } from "../schema.js";
import {
  SCHEMA_URL,
  fixtureScenarios,
  startFixtureSiteServer,
} from "./site-fixture.js";

const FIXTURES_SCHEMAS_DIR = join(import.meta.dirname, "fixtures");
const loadSchemaFn = createLocalFirstLoader(FIXTURES_SCHEMAS_DIR);

describe.sequential("agent-browser integration fixture", () => {
  const closers: Array<() => Promise<void>> = [];
  const sessionBrowserFns: BrowserFn[] = [];
  const originalHeaded = process.env["AGENT_BROWSER_HEADED"];

  afterAll(async () => {
    for (const fn of sessionBrowserFns) {
      await closeBrowser(fn).catch(() => {});
    }
  });

  afterEach(async () => {
    while (closers.length > 0) {
      await closers.pop()?.();
    }
    for (const fn of sessionBrowserFns) {
      await closeBrowser(fn).catch(() => {});
    }
    sessionBrowserFns.length = 0;
    if (originalHeaded === undefined) delete process.env["AGENT_BROWSER_HEADED"];
    else process.env["AGENT_BROWSER_HEADED"] = originalHeaded;
  });

  it("replays the deterministic playbook and yields both valid and invalid schema events", async () => {
    const server = await startFixtureSiteServer();
    closers.push(server.close);

    const deterministic = fixtureScenarios.find(
      (scenario) => scenario.name === "deterministic",
    );
    expect(deterministic).toBeDefined();

    const eventSchemas = await discoverEventSchemas(
      SCHEMA_URL,
      "web-datalayer-js",
      loadSchemaFn,
    );
    const accumulatedEvents: unknown[] = [];
    const { tools, browserFn } = buildAgentTools(accumulatedEvents, true);
    sessionBrowserFns.push(browserFn);

    await navigateTo(`${server.baseUrl}${deterministic!.route}`, browserFn);

    const replayResult = await replayPlaybook(
      deterministic!.deterministicPlaybook,
      async (step) => {
        const tool = tools.find((candidate) => candidate.name === step.tool);
        if (!tool) throw new Error(`Missing tool ${step.tool}`);
        const result = await tool.execute("integration", step.args as never);
        return (result.content[0] as { text?: string }).text ?? "";
      },
    );

    expect(replayResult.stuckAtIndex).toBe(-1);

    const observedEvents = await captureDataLayer(0, browserFn);
    expect(observedEvents).toHaveLength(4);

    const results = await validateAll(
      observedEvents,
      eventSchemas,
      SCHEMA_URL,
      loadSchemaFn,
    );
    const validEvents = results
      .filter((result) => result.result.valid)
      .map((result) => result.eventName);
    const invalidEvents = results
      .filter((result) => !result.result.valid)
      .map((result) => result.eventName);

    expect(validEvents).toEqual(
      expect.arrayContaining(deterministic!.expectedValidEvents),
    );
    expect(invalidEvents).toEqual(
      expect.arrayContaining(deterministic!.expectedInvalidEvents),
    );

    const observedEventNames = new Set(
      results.map((result) => result.eventName).filter(Boolean),
    );
    for (const missingEvent of deterministic!.expectedMissingEvents) {
      expect(observedEventNames.has(missingEvent)).toBe(false);
    }
  });

  it("gets stuck when the deterministic playbook is replayed against the mutated site", async () => {
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

    const accumulatedEvents: unknown[] = [];
    const { tools, browserFn } = buildAgentTools(accumulatedEvents, true);
    sessionBrowserFns.push(browserFn);

    await navigateTo(`${server.baseUrl}${mutated!.route}`, browserFn);

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
  });

  it("still captures the full journey when page-local dataLayer state is ephemeral", async () => {
    const server = await startFixtureSiteServer();
    closers.push(server.close);

    const ephemeral = fixtureScenarios.find(
      (scenario) => scenario.name === "ephemeral",
    );
    expect(ephemeral).toBeDefined();

    const eventSchemas = await discoverEventSchemas(
      SCHEMA_URL,
      "web-datalayer-js",
      loadSchemaFn,
    );
    const accumulatedEvents: unknown[] = [];
    const { tools, browserFn } = buildAgentTools(accumulatedEvents, true);
    sessionBrowserFns.push(browserFn);

    await navigateTo(`${server.baseUrl}${ephemeral!.route}`, browserFn);

    const replayResult = await replayPlaybook(
      ephemeral!.deterministicPlaybook,
      async (step) => {
        const tool = tools.find((candidate) => candidate.name === step.tool);
        if (!tool) throw new Error(`Missing tool ${step.tool}`);
        const result = await tool.execute("integration", step.args as never);
        return (result.content[0] as { text?: string }).text ?? "";
      },
    );

    expect(replayResult.stuckAtIndex).toBe(-1);

    const finalPageEvents = await captureDataLayer(0, browserFn);
    expect(finalPageEvents).toHaveLength(1);
    expect(finalPageEvents[0]).toEqual(
      expect.objectContaining({ event: "user_update" }),
    );

    expect(accumulatedEvents).toHaveLength(4);

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
    expect(observedEventNames.has("add_to_cart")).toBe(true);
    expect(observedEventNames.has("user_update")).toBe(true);
  }, 120_000);

  it("captures the checkout event across the checkout-to-payment redirect on the ephemeral site", async () => {
    const server = await startFixtureSiteServer();
    closers.push(server.close);

    const ephemeral = fixtureScenarios.find(
      (scenario) => scenario.name === "ephemeral",
    );
    expect(ephemeral).toBeDefined();

    const accumulatedEvents: unknown[] = [];
    const { tools, browserFn } = buildAgentTools(accumulatedEvents, true);
    sessionBrowserFns.push(browserFn);

    await navigateTo(`${server.baseUrl}${ephemeral!.route}`, browserFn);

    for (const step of ephemeral!.deterministicPlaybook.slice(0, 7)) {
      const tool = tools.find((candidate) => candidate.name === step.tool);
      if (!tool) throw new Error(`Missing tool ${step.tool}`);
      await tool.execute("integration", step.args as never);
    }

    const drained = await drainInterceptor(browserFn);
    const observedNames = new Set(
      [...accumulatedEvents, ...drained]
        .map((event) =>
          event && typeof event === "object"
            ? (event as Record<string, unknown>)["event"]
            : undefined,
        )
        .filter((name): name is string => typeof name === "string"),
    );

    expect(observedNames.has("address_submitted")).toBe(true);
  });

  it("captures the purchase event across the payment-to-profile redirect on the ephemeral site", async () => {
    const server = await startFixtureSiteServer();
    closers.push(server.close);

    const ephemeral = fixtureScenarios.find(
      (scenario) => scenario.name === "ephemeral",
    );
    expect(ephemeral).toBeDefined();

    const accumulatedEvents: unknown[] = [];
    const { tools, browserFn } = buildAgentTools(accumulatedEvents, true);
    sessionBrowserFns.push(browserFn);

    await navigateTo(`${server.baseUrl}${ephemeral!.route}`, browserFn);

    for (const step of ephemeral!.deterministicPlaybook.slice(0, 13)) {
      const tool = tools.find((candidate) => candidate.name === step.tool);
      if (!tool) throw new Error(`Missing tool ${step.tool}`);
      await tool.execute("integration", step.args as never);
    }

    const drained = await drainInterceptor(browserFn);
    const observedNames = new Set(
      [...accumulatedEvents, ...drained]
        .map((event) =>
          event && typeof event === "object"
            ? (event as Record<string, unknown>)["event"]
            : undefined,
        )
        .filter((name): name is string => typeof name === "string"),
    );

    expect(observedNames.has("purchase")).toBe(true);
  });
});
