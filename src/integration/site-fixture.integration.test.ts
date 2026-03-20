import { afterEach, describe, expect, it } from "vitest";
import {
  SCHEMA_URL,
  fixtureScenarios,
  startFixtureSiteServer,
} from "./site-fixture.js";

describe("integration site fixture", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (closers.length > 0) {
      await closers.pop()?.();
    }
  });

  it("defines deterministic, mutated, and ephemeral scenarios against the demo schema", () => {
    expect(SCHEMA_URL).toBe(
      "https://tracking-docs-demo.buchert.digital/schemas/1.3.0/event-reference.json",
    );

    expect(fixtureScenarios.map((scenario) => scenario.name)).toEqual([
      "deterministic",
      "mutated",
      "ephemeral",
    ]);

    expect(fixtureScenarios).toEqual([
      expect.objectContaining({
        name: "deterministic",
        route: "/deterministic/",
        dataLayerMode: "rehydrate",
        pages: expect.arrayContaining([
          "/deterministic/",
          "/deterministic/checkout.html",
          "/deterministic/payment.html",
          "/deterministic/profile.html",
          "/deterministic/transit.html",
        ]),
        deterministicPlaybook: expect.arrayContaining([
          expect.objectContaining({ tool: "browser_find" }),
          expect.objectContaining({ tool: "browser_wait" }),
        ]),
        expectedValidEvents: expect.arrayContaining(["purchase"]),
        expectedInvalidEvents: expect.arrayContaining([
          "add_to_cart",
          "user_update",
        ]),
        expectedMissingEvents: expect.arrayContaining(["checkout_complete"]),
      }),
      expect.objectContaining({
        name: "mutated",
        route: "/mutated/",
        dataLayerMode: "rehydrate",
        pages: expect.arrayContaining([
          "/mutated/",
          "/mutated/checkout.html",
          "/mutated/payment.html",
          "/mutated/profile.html",
          "/mutated/transit.html",
        ]),
        expectedValidEvents: expect.arrayContaining(["purchase"]),
      }),
      expect.objectContaining({
        name: "ephemeral",
        route: "/ephemeral/",
        dataLayerMode: "ephemeral",
        pages: expect.arrayContaining([
          "/ephemeral/",
          "/ephemeral/checkout.html",
          "/ephemeral/payment.html",
          "/ephemeral/profile.html",
          "/ephemeral/transit.html",
        ]),
        deterministicPlaybook: expect.arrayContaining([
          expect.objectContaining({ tool: "browser_find" }),
          expect.objectContaining({ tool: "browser_wait" }),
        ]),
      }),
    ]);
  });

  it("waits for networkidle after delayed-navigation button clicks in the stable playbook", () => {
    const deterministic = fixtureScenarios.find(
      (scenario) => scenario.name === "deterministic",
    );
    expect(deterministic).toBeDefined();
    const playbook = deterministic!.deterministicPlaybook;

    const continueToPamentIdx = playbook.findIndex(
      (step) =>
        step.tool === "browser_find" &&
        step.args["value"] === "continue-to-payment",
    );
    expect(continueToPamentIdx).toBeGreaterThanOrEqual(0);
    expect(playbook[continueToPamentIdx + 1]).toEqual({
      tool: "browser_wait",
      args: { load: "networkidle" },
    });

    const placeOrderIdx = playbook.findIndex(
      (step) =>
        step.tool === "browser_find" && step.args["value"] === "place-order",
    );
    expect(placeOrderIdx).toBeGreaterThanOrEqual(0);
    expect(playbook[placeOrderIdx + 1]).toEqual({
      tool: "browser_wait",
      args: { load: "networkidle" },
    });
  });

  it("serves deterministic, mutated, and ephemeral pages with their intended selector and timing behavior", async () => {
    const server = await startFixtureSiteServer();
    closers.push(server.close);

    const deterministicLanding = await fetch(
      `${server.baseUrl}/deterministic/`,
    ).then((response) => response.text());
    const deterministicCheckout = await fetch(
      `${server.baseUrl}/deterministic/checkout.html`,
    ).then((response) => response.text());
    const deterministicPayment = await fetch(
      `${server.baseUrl}/deterministic/payment.html`,
    ).then((response) => response.text());
    const deterministicProfile = await fetch(
      `${server.baseUrl}/deterministic/profile.html`,
    ).then((response) => response.text());
    const deterministicTransit = await fetch(
      `${server.baseUrl}/deterministic/transit.html?next=%2Fdeterministic%2Fcheckout.html&label=checkout`,
    ).then((response) => response.text());

    const mutatedLanding = await fetch(`${server.baseUrl}/mutated/`).then(
      (response) => response.text(),
    );
    const mutatedCheckout = await fetch(
      `${server.baseUrl}/mutated/checkout.html`,
    ).then((response) => response.text());
    const mutatedPayment = await fetch(
      `${server.baseUrl}/mutated/payment.html`,
    ).then((response) => response.text());
    const mutatedProfile = await fetch(
      `${server.baseUrl}/mutated/profile.html`,
    ).then((response) => response.text());
    const mutatedTransit = await fetch(
      `${server.baseUrl}/mutated/transit.html?next=%2Fmutated%2Fcheckout.html&label=checkout`,
    ).then((response) => response.text());

    const ephemeralLanding = await fetch(`${server.baseUrl}/ephemeral/`).then(
      (response) => response.text(),
    );
    const ephemeralCheckout = await fetch(
      `${server.baseUrl}/ephemeral/checkout.html`,
    ).then((response) => response.text());
    const ephemeralPayment = await fetch(
      `${server.baseUrl}/ephemeral/payment.html`,
    ).then((response) => response.text());
    const ephemeralProfile = await fetch(
      `${server.baseUrl}/ephemeral/profile.html`,
    ).then((response) => response.text());
    const ephemeralTransit = await fetch(
      `${server.baseUrl}/ephemeral/transit.html?next=%2Fephemeral%2Fcheckout.html&label=checkout`,
    ).then((response) => response.text());

    const sharedScript = await fetch(
      `${server.baseUrl}/shared/fixture-store.js`,
    ).then((response) => response.text());

    expect(deterministicLanding).toContain('data-testid="start-checkout"');
    expect(deterministicCheckout).toContain('data-testid="broken-cart"');
    expect(deterministicCheckout).toContain('data-testid="email"');
    expect(deterministicCheckout).toContain(
      'data-testid="continue-to-payment"',
    );
    expect(deterministicPayment).toContain('data-testid="card-number"');
    expect(deterministicPayment).toContain('data-testid="place-order"');
    expect(deterministicProfile).toContain('data-testid="profile-update"');
    expect(deterministicTransit).toContain("Redirecting to checkout");
    expect(deterministicTransit).toContain("setTimeout");
    expect(deterministicCheckout).toContain("setTimeout");
    expect(deterministicPayment).toContain("setTimeout");
    expect(deterministicProfile).toContain("setTimeout");
    expect(deterministicCheckout).toContain('data-data-layer-mode="rehydrate"');

    expect(mutatedLanding).not.toContain('data-testid="start-checkout"');
    expect(mutatedLanding).toContain('data-testid="launch-journey"');
    expect(mutatedCheckout).toContain('data-testid="cart-warning"');
    expect(mutatedCheckout).toContain('data-testid="contact-email"');
    expect(mutatedCheckout).toContain('data-testid="zip-entry"');
    expect(mutatedCheckout).toContain('data-testid="region-entry"');
    expect(mutatedCheckout).toContain('data-testid="payment-step"');
    expect(mutatedPayment).toContain('data-testid="pan-field"');
    expect(mutatedPayment).toContain('data-testid="cardholder"');
    expect(mutatedPayment).toContain('data-testid="submit-order"');
    expect(mutatedProfile).toContain('data-testid="account-pulse"');
    expect(mutatedCheckout).not.toContain('data-testid="postal-code"');
    expect(mutatedPayment).not.toContain('data-testid="card-name"');
    expect(mutatedTransit).toContain("Redirecting to checkout");
    expect(mutatedTransit).toContain("setTimeout");
    expect(mutatedCheckout).toContain("setTimeout");
    expect(mutatedPayment).toContain("setTimeout");
    expect(mutatedProfile).toContain("setTimeout");

    expect(ephemeralLanding).toContain('data-testid="start-checkout"');
    expect(ephemeralCheckout).toContain('data-testid="broken-cart"');
    expect(ephemeralCheckout).toContain('data-testid="email"');
    expect(ephemeralPayment).toContain('data-testid="card-number"');
    expect(ephemeralProfile).toContain('data-testid="profile-update"');
    expect(ephemeralTransit).toContain("Redirecting to checkout");
    expect(ephemeralCheckout).toContain('data-data-layer-mode="ephemeral"');
    expect(ephemeralPayment).toContain('data-data-layer-mode="ephemeral"');
    expect(ephemeralProfile).toContain('data-data-layer-mode="ephemeral"');

    expect(sharedScript).toContain("window.fixtureStore");
    expect(sharedScript).toContain("tracking-fixture-events");
    expect(sharedScript).toContain("rehydrate");
    expect(sharedScript).toContain("ephemeral");
  });
});
