import { describe, it, expect } from "vitest";
import { buildInitialPrompt, createSystemPrompt } from "./prompts.js";
import type { EventSchema } from "../schema.js";

describe("buildInitialPrompt", () => {
  const schemaUrl = "https://example.com/schema.json";
  const targetUrl = "https://mysite.com";
  const eventSchemas: EventSchema[] = [
    {
      eventName: "purchase",
      schemaUrl: "https://example.com/schemas/web/purchase.json",
    },
    {
      eventName: "add_to_cart",
      schemaUrl: "https://example.com/schemas/web/add-to-cart.json",
    },
  ];

  it("includes the target URL", () => {
    const prompt = buildInitialPrompt(schemaUrl, targetUrl, eventSchemas);
    expect(prompt).toContain(targetUrl);
  });

  it("instructs the agent to validate events", () => {
    const prompt = buildInitialPrompt(schemaUrl, targetUrl, eventSchemas);
    expect(prompt.toLowerCase()).toMatch(/validat/);
  });

  it("embeds each event name in the prompt", () => {
    const prompt = buildInitialPrompt(schemaUrl, targetUrl, eventSchemas);
    expect(prompt).toContain("purchase");
    expect(prompt).toContain("add_to_cart");
  });

  it("embeds each sub-schema URL in the prompt", () => {
    const prompt = buildInitialPrompt(schemaUrl, targetUrl, eventSchemas);
    expect(prompt).toContain("https://example.com/schemas/web/purchase.json");
    expect(prompt).toContain(
      "https://example.com/schemas/web/add-to-cart.json",
    );
  });

  it("does NOT instruct the agent to fetch or discover schemas", () => {
    const prompt = buildInitialPrompt(schemaUrl, targetUrl, eventSchemas);
    expect(prompt.toLowerCase()).not.toMatch(
      /fetch.*schema|discover.*schema|\$ref/,
    );
  });

  it("includes the description when present so the agent knows where the event fires", () => {
    const schemas: EventSchema[] = [
      {
        eventName: "purchase",
        schemaUrl: "https://example.com/schemas/web/purchase.json",
        description: "Fires when a user completes a purchase.",
      },
    ];
    const prompt = buildInitialPrompt(schemaUrl, targetUrl, schemas);
    expect(prompt).toContain("Fires when a user completes a purchase.");
    expect(prompt).toContain(" — Fires when");
  });

  it("does not contain unresolved placeholders", () => {
    const prompt = buildInitialPrompt(schemaUrl, targetUrl, eventSchemas);
    expect(prompt).not.toContain("{{schemaUrl}}");
    expect(prompt).not.toContain("{{targetUrl}}");
    expect(prompt).not.toContain("{{eventSchemas}}");
  });

  it("separates multiple events with newlines", () => {
    const prompt = buildInitialPrompt(schemaUrl, targetUrl, eventSchemas);
    const idx1 = prompt.indexOf("purchase");
    const idx2 = prompt.indexOf("add_to_cart");
    const between = prompt.slice(idx1, idx2);
    expect(between).toContain("\n");
  });

  it("omits the description marker when description is absent", () => {
    const schemas: EventSchema[] = [
      {
        eventName: "purchase",
        schemaUrl: "https://example.com/schemas/web/purchase.json",
      },
    ];
    const prompt = buildInitialPrompt(schemaUrl, targetUrl, schemas);
    expect(prompt).not.toContain(" — undefined");
    expect(prompt).not.toContain(" — \n");
  });

  it("adds no text between event name and schema line when description is absent", () => {
    const schemas: EventSchema[] = [
      {
        eventName: "purchase",
        schemaUrl: "https://example.com/purchase.json",
      },
    ];
    const prompt = buildInitialPrompt(schemaUrl, targetUrl, schemas);
    // Mutation at L24:68 changes "" to "Stryker was here!", breaking this assertion
    expect(prompt).toContain("- purchase\n  Schema:");
  });
});

describe("createSystemPrompt", () => {
  it("returns a non-empty string", () => {
    expect(createSystemPrompt().length).toBeGreaterThan(50);
  });

  it("mentions dataLayer", () => {
    expect(createSystemPrompt()).toContain("dataLayer");
  });

  it("mentions validation", () => {
    expect(createSystemPrompt().toLowerCase()).toMatch(/validat/);
  });

  it("mentions the schema", () => {
    expect(createSystemPrompt().toLowerCase()).toMatch(/schema/);
  });

  it("does not instruct the agent to call validate_event — validation is done in code", () => {
    expect(createSystemPrompt()).not.toContain("validate_event");
  });
});
