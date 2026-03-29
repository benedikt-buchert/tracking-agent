import { describe, expect, it } from "vitest";
import { loadCredentials, formatCredentialsSummary } from "./credentials.js";

describe("loadCredentials", () => {
  const read = (content: string) => async () => content;

  it("rejects non-JSON content", async () => {
    await expect(loadCredentials("f.json", read("not json"))).rejects.toThrow(
      "Invalid JSON",
    );
  });

  it("rejects JSON without fields key", async () => {
    await expect(
      loadCredentials("f.json", read(JSON.stringify({ other: 1 }))),
    ).rejects.toThrow("fields");
  });

  it("rejects empty fields object", async () => {
    await expect(
      loadCredentials("f.json", read(JSON.stringify({ fields: {} }))),
    ).rejects.toThrow("empty");
  });

  it("rejects field missing value", async () => {
    await expect(
      loadCredentials(
        "f.json",
        read(JSON.stringify({ fields: { email: { description: "Email" } } })),
      ),
    ).rejects.toThrow("value");
  });

  it("rejects field missing description", async () => {
    await expect(
      loadCredentials(
        "f.json",
        read(
          JSON.stringify({
            fields: { email: { value: "a@b.com" } },
          }),
        ),
      ),
    ).rejects.toThrow("description");
  });

  it("rejects field with non-string value", async () => {
    await expect(
      loadCredentials(
        "f.json",
        read(
          JSON.stringify({
            fields: { email: { description: "Email", value: 123 } },
          }),
        ),
      ),
    ).rejects.toThrow("value");
  });

  it("returns store from valid input", async () => {
    const store = await loadCredentials(
      "f.json",
      read(
        JSON.stringify({
          fields: {
            email: { description: "Login email", value: "a@b.com" },
          },
        }),
      ),
    );
    expect(store).toBeDefined();
  });

  it("store.get returns value for known field", async () => {
    const store = await loadCredentials(
      "f.json",
      read(
        JSON.stringify({
          fields: {
            email: { description: "Login email", value: "a@b.com" },
          },
        }),
      ),
    );
    expect(store.get("email")).toBe("a@b.com");
  });

  it("store.get returns undefined for unknown field", async () => {
    const store = await loadCredentials(
      "f.json",
      read(
        JSON.stringify({
          fields: {
            email: { description: "Login email", value: "a@b.com" },
          },
        }),
      ),
    );
    expect(store.get("unknown")).toBeUndefined();
  });

  it("store.fieldSummary returns names and descriptions without values", async () => {
    const store = await loadCredentials(
      "f.json",
      read(
        JSON.stringify({
          fields: {
            email: { description: "Login email", value: "a@b.com" },
            password: { description: "Password", value: "secret" },
          },
        }),
      ),
    );
    const summary = store.fieldSummary();
    expect(summary).toEqual([
      { name: "email", description: "Login email" },
      { name: "password", description: "Password" },
    ]);
    // Ensure no value leaks into the summary
    expect(JSON.stringify(summary)).not.toContain("a@b.com");
    expect(JSON.stringify(summary)).not.toContain("secret");
  });

  it("stagehandVariables returns values and descriptions for secure Stagehand injection", async () => {
    const store = await loadCredentials(
      "f.json",
      read(
        JSON.stringify({
          fields: {
            email: { description: "Login email", value: "a@b.com" },
            password: { description: "Password", value: "secret" },
          },
        }),
      ),
    );

    expect(store.stagehandVariables()).toEqual({
      email: { description: "Login email", value: "a@b.com" },
      password: { description: "Password", value: "secret" },
    });
  });
});

describe("formatCredentialsSummary", () => {
  it("lists field names and descriptions", () => {
    const summary = formatCredentialsSummary([
      { name: "email", description: "Login email" },
      { name: "card", description: "Credit card number" },
    ]);
    expect(summary).toContain("email");
    expect(summary).toContain("Login email");
    expect(summary).toContain("card");
    expect(summary).toContain("Credit card number");
    expect(summary).toContain("Stagehand variables");
  });

  it("returns empty string when no fields", () => {
    expect(formatCredentialsSummary([])).toBe("");
  });
});
