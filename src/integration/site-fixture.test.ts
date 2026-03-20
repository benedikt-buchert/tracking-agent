import { describe, it, expect, afterEach } from "vitest";
import {
  startFixtureSiteServer,
  fixtureScenarios,
  SCHEMA_URL,
} from "./site-fixture.js";

describe("SCHEMA_URL", () => {
  it("points to the event-reference.json endpoint", () => {
    expect(SCHEMA_URL).toContain("event-reference.json");
    expect(SCHEMA_URL).toMatch(/^https:\/\//);
  });
});

describe("fixtureScenarios", () => {
  it("has exactly three scenarios: deterministic, mutated, ephemeral", () => {
    const names = fixtureScenarios.map((s) => s.name);
    expect(names).toEqual(["deterministic", "mutated", "ephemeral"]);
  });

  it("each scenario has a route matching its name", () => {
    for (const scenario of fixtureScenarios) {
      expect(scenario.route).toContain(scenario.name);
    }
  });

  it("deterministic scenario uses rehydrate dataLayerMode", () => {
    const det = fixtureScenarios.find((s) => s.name === "deterministic")!;
    expect(det.dataLayerMode).toBe("rehydrate");
  });

  it("ephemeral scenario uses ephemeral dataLayerMode", () => {
    const eph = fixtureScenarios.find((s) => s.name === "ephemeral")!;
    expect(eph.dataLayerMode).toBe("ephemeral");
  });

  it("deterministic playbook includes a browser_find click on start-checkout", () => {
    const det = fixtureScenarios.find((s) => s.name === "deterministic")!;
    const firstStep = det.deterministicPlaybook[0];
    expect(firstStep.tool).toBe("browser_find");
    expect(firstStep.args).toMatchObject({
      locator: "testid",
      value: "start-checkout",
      action: "click",
    });
  });

  it("all scenarios share the same expectedValidEvents", () => {
    const validEvents = fixtureScenarios[0].expectedValidEvents;
    expect(validEvents).toContain("purchase");
    expect(validEvents).toContain("address_submitted");
    for (const scenario of fixtureScenarios) {
      expect(scenario.expectedValidEvents).toEqual(validEvents);
    }
  });

  it("all scenarios include checkout_complete in expectedMissingEvents", () => {
    for (const scenario of fixtureScenarios) {
      expect(scenario.expectedMissingEvents).toContain("checkout_complete");
    }
  });

  it("deterministic scenario pages include the checkout page", () => {
    const det = fixtureScenarios.find((s) => s.name === "deterministic")!;
    expect(det.pages).toContain("/deterministic/checkout.html");
  });

  it("mutated playbook starts with launch-journey instead of start-checkout", () => {
    const mut = fixtureScenarios.find((s) => s.name === "mutated")!;
    const firstStep = mut.deterministicPlaybook[0];
    expect(firstStep.args).toMatchObject({ value: "launch-journey" });
  });
});

describe("startFixtureSiteServer", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) {
      await close();
      close = undefined;
    }
  });

  it("returns a baseUrl with http://127.0.0.1 and a port", async () => {
    const server = await startFixtureSiteServer();
    close = server.close;
    expect(server.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("serves index.html at the root path with text/html content-type", async () => {
    const server = await startFixtureSiteServer();
    close = server.close;

    const res = await fetch(`${server.baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("serves .js files with text/javascript content-type", async () => {
    const server = await startFixtureSiteServer();
    close = server.close;

    const res = await fetch(`${server.baseUrl}/shared/fixture-store.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
  });

  it("serves .css files with text/css content-type", async () => {
    const server = await startFixtureSiteServer();
    close = server.close;

    const res = await fetch(`${server.baseUrl}/shared/test.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
  });

  it("serves .json files with application/json content-type", async () => {
    const server = await startFixtureSiteServer();
    close = server.close;

    const res = await fetch(`${server.baseUrl}/shared/test.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("resolves trailing slash paths to index.html", async () => {
    const server = await startFixtureSiteServer();
    close = server.close;

    const res = await fetch(`${server.baseUrl}/deterministic/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("returns 404 for a missing file", async () => {
    const server = await startFixtureSiteServer();
    close = server.close;

    const res = await fetch(`${server.baseUrl}/nonexistent-file.html`);
    expect(res.status).toBe(404);
  });

  it("strips query strings when resolving paths", async () => {
    const server = await startFixtureSiteServer();
    close = server.close;

    const res = await fetch(`${server.baseUrl}/?foo=bar`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("serves non-root HTML pages correctly", async () => {
    const server = await startFixtureSiteServer();
    close = server.close;

    const res = await fetch(`${server.baseUrl}/deterministic/checkout.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("serves unknown extensions with text/plain content-type", async () => {
    const server = await startFixtureSiteServer();
    close = server.close;

    const res = await fetch(`${server.baseUrl}/shared/test.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
  });

  it("close() resolves without error", async () => {
    const server = await startFixtureSiteServer();
    close = undefined;
    await expect(server.close()).resolves.toBeUndefined();
  });
});
