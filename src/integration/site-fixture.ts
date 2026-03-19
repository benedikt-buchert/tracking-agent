import { createServer } from "http";
import { readFile } from "fs/promises";
import { extname, join, normalize, resolve } from "path";

export const SCHEMA_URL =
  "https://tracking-docs-demo.buchert.digital/schemas/1.3.0/event-reference.json";

export interface FixtureScenario {
  name: "deterministic" | "mutated" | "ephemeral";
  route: "/deterministic/" | "/mutated/" | "/ephemeral/";
  pages: string[];
  dataLayerMode: "rehydrate" | "ephemeral";
  expectedValidEvents: string[];
  expectedInvalidEvents: string[];
  expectedMissingEvents: string[];
  deterministicPlaybook: Array<{
    tool: "browser_click" | "browser_fill" | "browser_find" | "browser_wait";
    args: Record<string, string | number>;
  }>;
}

const deterministicStablePlaybook: FixtureScenario["deterministicPlaybook"] = [
  {
    tool: "browser_find",
    args: { locator: "testid", value: "start-checkout", action: "click" },
  },
  {
    tool: "browser_wait",
    args: { selector: '[data-testid="broken-cart"]' },
  },
  {
    tool: "browser_find",
    args: { locator: "testid", value: "broken-cart", action: "click" },
  },
  {
    tool: "browser_find",
    args: {
      locator: "testid",
      value: "email",
      action: "fill",
      fill_text: "buyer@example.com",
    },
  },
  {
    tool: "browser_find",
    args: {
      locator: "testid",
      value: "postal-code",
      action: "fill",
      fill_text: "90210",
    },
  },
  {
    tool: "browser_find",
    args: {
      locator: "testid",
      value: "state",
      action: "fill",
      fill_text: "CA",
    },
  },
  {
    tool: "browser_find",
    args: {
      locator: "testid",
      value: "continue-to-payment",
      action: "click",
    },
  },
  {
    tool: "browser_wait",
    args: { selector: '[data-testid="card-number"]' },
  },
  {
    tool: "browser_find",
    args: {
      locator: "testid",
      value: "card-number",
      action: "fill",
      fill_text: "4242424242424242",
    },
  },
  {
    tool: "browser_find",
    args: {
      locator: "testid",
      value: "card-cvc",
      action: "fill",
      fill_text: "123",
    },
  },
  {
    tool: "browser_find",
    args: {
      locator: "testid",
      value: "card-name",
      action: "fill",
      fill_text: "Test Buyer",
    },
  },
  {
    tool: "browser_find",
    args: { locator: "testid", value: "place-order", action: "click" },
  },
  {
    tool: "browser_wait",
    args: { selector: '[data-testid="profile-update"]' },
  },
  {
    tool: "browser_find",
    args: { locator: "testid", value: "profile-update", action: "click" },
  },
];

export const fixtureScenarios: FixtureScenario[] = [
  {
    name: "deterministic",
    route: "/deterministic/",
    pages: [
      "/deterministic/",
      "/deterministic/checkout.html",
      "/deterministic/payment.html",
      "/deterministic/profile.html",
      "/deterministic/transit.html",
    ],
    dataLayerMode: "rehydrate",
    expectedValidEvents: ["purchase", "address_submitted"],
    expectedInvalidEvents: ["add_to_cart", "user_update"],
    expectedMissingEvents: [
      "checkout_complete",
      "option_a",
      "option_b",
      "choice_event",
      "nested_choice",
    ],
    deterministicPlaybook: deterministicStablePlaybook,
  },
  {
    name: "mutated",
    route: "/mutated/",
    pages: [
      "/mutated/",
      "/mutated/checkout.html",
      "/mutated/payment.html",
      "/mutated/profile.html",
      "/mutated/transit.html",
    ],
    dataLayerMode: "rehydrate",
    expectedValidEvents: ["purchase", "address_submitted"],
    expectedInvalidEvents: ["add_to_cart", "user_update"],
    expectedMissingEvents: [
      "checkout_complete",
      "option_a",
      "option_b",
      "choice_event",
      "nested_choice",
    ],
    deterministicPlaybook: [
      {
        tool: "browser_find",
        args: { locator: "testid", value: "launch-journey", action: "click" },
      },
      {
        tool: "browser_wait",
        args: { selector: '[data-testid="cart-warning"]' },
      },
      {
        tool: "browser_find",
        args: { locator: "testid", value: "cart-warning", action: "click" },
      },
      {
        tool: "browser_find",
        args: {
          locator: "testid",
          value: "contact-email",
          action: "fill",
          fill_text: "buyer@example.com",
        },
      },
      {
        tool: "browser_find",
        args: {
          locator: "testid",
          value: "zip-entry",
          action: "fill",
          fill_text: "90210",
        },
      },
      {
        tool: "browser_find",
        args: {
          locator: "testid",
          value: "region-entry",
          action: "fill",
          fill_text: "CA",
        },
      },
      {
        tool: "browser_find",
        args: { locator: "testid", value: "payment-step", action: "click" },
      },
      {
        tool: "browser_wait",
        args: { selector: '[data-testid="pan-field"]' },
      },
      {
        tool: "browser_find",
        args: {
          locator: "testid",
          value: "pan-field",
          action: "fill",
          fill_text: "4242424242424242",
        },
      },
      {
        tool: "browser_find",
        args: {
          locator: "testid",
          value: "security-code",
          action: "fill",
          fill_text: "123",
        },
      },
      {
        tool: "browser_find",
        args: {
          locator: "testid",
          value: "cardholder",
          action: "fill",
          fill_text: "Test Buyer",
        },
      },
      {
        tool: "browser_find",
        args: { locator: "testid", value: "submit-order", action: "click" },
      },
      {
        tool: "browser_wait",
        args: { selector: '[data-testid="account-pulse"]' },
      },
      {
        tool: "browser_find",
        args: { locator: "testid", value: "account-pulse", action: "click" },
      },
    ],
  },
  {
    name: "ephemeral",
    route: "/ephemeral/",
    pages: [
      "/ephemeral/",
      "/ephemeral/checkout.html",
      "/ephemeral/payment.html",
      "/ephemeral/profile.html",
      "/ephemeral/transit.html",
    ],
    dataLayerMode: "ephemeral",
    expectedValidEvents: ["purchase", "address_submitted"],
    expectedInvalidEvents: ["add_to_cart", "user_update"],
    expectedMissingEvents: [
      "checkout_complete",
      "option_a",
      "option_b",
      "choice_event",
      "nested_choice",
    ],
    deterministicPlaybook: deterministicStablePlaybook,
  },
];

export function fixtureSiteRoot(): string {
  return resolve(import.meta.dirname, "..", "..", "integration-site");
}

function contentTypeFor(filePath: string): string {
  const ext = extname(filePath);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function resolveFixturePath(urlPath: string): string {
  const cleanPath = urlPath.split("?")[0]?.split("#")[0] ?? "/";
  const relativePath =
    cleanPath === "/"
      ? "deterministic/index.html"
      : cleanPath.endsWith("/")
        ? `${cleanPath.slice(1)}index.html`
        : cleanPath.slice(1);
  return normalize(join(fixtureSiteRoot(), relativePath));
}

export async function startFixtureSiteServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const root = fixtureSiteRoot();
  const server = createServer(async (req, res) => {
    const requestPath = req.url ?? "/";
    const filePath = resolveFixturePath(requestPath);

    if (!filePath.startsWith(root)) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }

    try {
      const content = await readFile(filePath);
      res.statusCode = 200;
      res.setHeader("Content-Type", contentTypeFor(filePath));
      res.end(content);
    } catch {
      res.statusCode = 404;
      res.end("Not found");
    }
  });

  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", () => resolveListen());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server failed to bind to a local port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) rejectClose(error);
          else resolveClose();
        });
      }),
  };
}
