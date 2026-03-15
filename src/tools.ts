import { exec } from "child_process";
import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";

const VALIDATOR_BASE_URL = process.env.VALIDATOR_URL ?? "http://localhost:3000";

async function runBrowser(args: string): Promise<string> {
  return new Promise((resolve) => {
    exec(`agent-browser ${args}`, { timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) {
        resolve(err.stdout?.trim() || err.stderr?.trim() || err.message);
      } else {
        resolve(stdout?.trim() || stderr?.trim() || "");
      }
    });
  });
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

// ─── Tool: navigate ──────────────────────────────────────────────────────────

const NavigateParams = Type.Object({
  url: Type.String({ description: "Full URL to navigate to" }),
});

export const navigateTool: AgentTool<typeof NavigateParams> = {
  name: "browser_navigate",
  description:
    "Open a URL in the browser. Wait for the page to be idle after navigation.",
  label: "Navigating browser",
  parameters: NavigateParams,
  execute: async (_id, { url }) => {
    const out = await runBrowser(
      `open "${url}" && agent-browser wait --load networkidle`
    );
    return textResult(out || "Navigated successfully");
  },
};

// ─── Tool: snapshot ───────────────────────────────────────────────────────────

const SnapshotParams = Type.Object({
  interactive_only: Type.Optional(
    Type.Boolean({
      description:
        "If true, return only interactive elements (buttons, links, inputs). Reduces output size.",
    })
  ),
});

export const snapshotTool: AgentTool<typeof SnapshotParams> = {
  name: "browser_snapshot",
  description:
    "Get the accessibility tree of the current page. Returns element refs (e.g. @e1, @e2) that you can use with other tools.",
  label: "Taking snapshot",
  parameters: SnapshotParams,
  execute: async (_id, { interactive_only }) => {
    const flag = interactive_only ? " -i" : "";
    const out = await runBrowser(`snapshot${flag}`);
    return textResult(out);
  },
};

// ─── Tool: click ─────────────────────────────────────────────────────────────

const ClickParams = Type.Object({
  selector: Type.String({
    description:
      "Element ref from snapshot (e.g. @e2) or CSS selector or text to click",
  }),
});

export const clickTool: AgentTool<typeof ClickParams> = {
  name: "browser_click",
  description: "Click an element on the page.",
  label: "Clicking element",
  parameters: ClickParams,
  execute: async (_id, { selector }) => {
    const out = await runBrowser(`click "${selector}"`);
    return textResult(out || "Clicked");
  },
};

// ─── Tool: fill ───────────────────────────────────────────────────────────────

const FillParams = Type.Object({
  selector: Type.String({ description: "Element ref or CSS selector" }),
  text: Type.String({ description: "Text to fill into the element" }),
});

export const fillTool: AgentTool<typeof FillParams> = {
  name: "browser_fill",
  description: "Clear and fill a form field with text.",
  label: "Filling input",
  parameters: FillParams,
  execute: async (_id, { selector, text }) => {
    const out = await runBrowser(`fill "${selector}" "${text}"`);
    return textResult(out || "Filled");
  },
};

// ─── Tool: eval ───────────────────────────────────────────────────────────────

const EvalParams = Type.Object({
  js: Type.String({
    description: "JavaScript expression to evaluate in the browser context",
  }),
});

export const evalTool: AgentTool<typeof EvalParams> = {
  name: "browser_eval",
  description:
    "Run JavaScript in the browser and return the result as a string.",
  label: "Running JS",
  parameters: EvalParams,
  execute: async (_id, { js }) => {
    const escaped = js.replace(/'/g, `'\\''`);
    const out = await runBrowser(`eval '${escaped}'`);
    return textResult(out);
  },
};

// ─── Tool: screenshot ────────────────────────────────────────────────────────

const ScreenshotParams = Type.Object({
  path: Type.Optional(
    Type.String({ description: "File path to save screenshot (optional)" })
  ),
});

export const screenshotTool: AgentTool<typeof ScreenshotParams> = {
  name: "browser_screenshot",
  description: "Take a screenshot of the current page.",
  label: "Taking screenshot",
  parameters: ScreenshotParams,
  execute: async (_id, { path }) => {
    const arg = path ? ` "${path}"` : "";
    const out = await runBrowser(`screenshot${arg}`);
    return textResult(out || "Screenshot taken");
  },
};

// ─── Tool: wait ───────────────────────────────────────────────────────────────

const WaitParams = Type.Object({
  target: Type.String({
    description:
      "CSS selector to wait for, or number of milliseconds (e.g. '1000'), or '--load networkidle'",
  }),
});

export const waitTool: AgentTool<typeof WaitParams> = {
  name: "browser_wait",
  description: "Wait for an element to appear, a condition, or a time period.",
  label: "Waiting",
  parameters: WaitParams,
  execute: async (_id, { target }) => {
    const out = await runBrowser(`wait ${target}`);
    return textResult(out || "Wait complete");
  },
};

// ─── Tool: get_datalayer ─────────────────────────────────────────────────────

const GetDataLayerParams = Type.Object({
  from_index: Type.Optional(
    Type.Number({
      description:
        "Return only events from this index onwards (to get new events since last check). Defaults to 0 (all events).",
    })
  ),
});

export const getDataLayerTool: AgentTool<typeof GetDataLayerParams> = {
  name: "get_datalayer",
  description:
    "Get the current contents of window.dataLayer from the browser. Returns JSON array of all dataLayer pushes.",
  label: "Reading dataLayer",
  parameters: GetDataLayerParams,
  execute: async (_id, { from_index }) => {
    const idx = from_index ?? 0;
    const js = `JSON.stringify((window.dataLayer || []).slice(${idx}))`;
    const escaped = js.replace(/'/g, `'\\''`);
    const out = await runBrowser(`eval '${escaped}'`);
    return textResult(out || "[]");
  },
};

// ─── Tool: fetch_schema ───────────────────────────────────────────────────────

const FetchSchemaParams = Type.Object({
  url: Type.String({ description: "URL of the JSON Schema to fetch" }),
});

export const fetchSchemaTool: AgentTool<typeof FetchSchemaParams> = {
  name: "fetch_schema",
  description:
    "Fetch a JSON Schema from a URL and return its contents. Use this to understand the expected tracking event structure.",
  label: "Fetching schema",
  parameters: FetchSchemaParams,
  execute: async (_id, { url }) => {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        return textResult(`Error fetching schema: HTTP ${res.status}`);
      }
      const json = await res.json();
      return textResult(JSON.stringify(json, null, 2));
    } catch (err) {
      return textResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

// ─── Tool: validate_event ────────────────────────────────────────────────────

const ValidateEventParams = Type.Object({
  event: Type.Object(
    {},
    {
      description:
        "The dataLayer event object to validate (as a JSON object)",
      additionalProperties: true,
    }
  ),
  schema_url: Type.String({
    description:
      "URL of the JSON Schema to validate against (e.g. https://tracking-docs-demo.buchert.digital/schemas/1.3.0/event-reference.json)",
  }),
});

export const validateEventTool: AgentTool<typeof ValidateEventParams> = {
  name: "validate_event",
  description:
    "Validate a single dataLayer event object against a JSON Schema using the tracking validator server. Returns validation result with any errors.",
  label: "Validating event",
  parameters: ValidateEventParams,
  execute: async (_id, { event, schema_url }) => {
    try {
      const payload = { ...event, $schema: schema_url };
      const res = await fetch(`${VALIDATOR_BASE_URL}/v1/validate/remote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      return textResult(JSON.stringify(result, null, 2));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return textResult(
        `Error contacting validator at ${VALIDATOR_BASE_URL}: ${msg}\n\nMake sure the tracking_validator server is running (npm start in the tracking_validator directory).`
      );
    }
  },
};

// ─── Tool: find ───────────────────────────────────────────────────────────────

const FindParams = Type.Object({
  locator: Type.Union(
    [
      Type.Literal("role"),
      Type.Literal("text"),
      Type.Literal("label"),
      Type.Literal("placeholder"),
      Type.Literal("testid"),
    ],
    { description: "How to locate the element" }
  ),
  value: Type.String({ description: "Value to search for" }),
  action: Type.Union([Type.Literal("click"), Type.Literal("fill")], {
    description: "Action to perform on the found element",
  }),
  fill_text: Type.Optional(
    Type.String({ description: "Text to fill (required when action is fill)" })
  ),
});

export const findTool: AgentTool<typeof FindParams> = {
  name: "browser_find",
  description:
    "Find an element by role, text, label, placeholder, or test ID and perform an action on it.",
  label: "Finding element",
  parameters: FindParams,
  execute: async (_id, { locator, value, action, fill_text }) => {
    const extra = action === "fill" && fill_text ? ` "${fill_text}"` : "";
    const out = await runBrowser(
      `find ${locator} "${value}" ${action}${extra}`
    );
    return textResult(out || "Done");
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const allTools: AgentTool<any>[] = [
  fetchSchemaTool,
  navigateTool,
  snapshotTool,
  clickTool,
  fillTool,
  findTool,
  evalTool,
  waitTool,
  getDataLayerTool,
  screenshotTool,
  validateEventTool,
];
