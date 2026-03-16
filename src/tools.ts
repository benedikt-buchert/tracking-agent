import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { defaultBrowserFn } from "./runner.js";
import type { BrowserFn } from "./runner.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

// ─── Tool: navigate ──────────────────────────────────────────────────────────

const NavigateParams = Type.Object({
  url: Type.String({ description: "Full URL to navigate to" }),
});

export function createNavigateTool(browserFn: BrowserFn = defaultBrowserFn): AgentTool<typeof NavigateParams> {
  return {
    name: "browser_navigate",
    description:
      "Open a URL in the browser. Wait for the page to be idle after navigation.",
    label: "Navigating browser",
    parameters: NavigateParams,
    execute: async (_id, { url }) => {
      const out = await browserFn(
        `open "${url}" && agent-browser wait --load networkidle`
      );
      return textResult(out || "Navigated successfully");
    },
  };
}

export const navigateTool = createNavigateTool();

// ─── Tool: snapshot ───────────────────────────────────────────────────────────

const SnapshotParams = Type.Object({
  interactive_only: Type.Optional(
    Type.Boolean({
      description:
        "If true, return only interactive elements (buttons, links, inputs). Reduces output size.",
    })
  ),
});

export function createSnapshotTool(browserFn: BrowserFn = defaultBrowserFn): AgentTool<typeof SnapshotParams> {
  return {
    name: "browser_snapshot",
    description:
      "Get the accessibility tree of the current page. Returns element refs (e.g. @e1, @e2) that you can use with other tools.",
    label: "Taking snapshot",
    parameters: SnapshotParams,
    execute: async (_id, { interactive_only }) => {
      const flag = interactive_only ? " -i" : "";
      const out = await browserFn(`snapshot${flag}`);
      return textResult(out);
    },
  };
}

export const snapshotTool = createSnapshotTool();

// ─── Tool: click ─────────────────────────────────────────────────────────────

const ClickParams = Type.Object({
  selector: Type.String({
    description:
      "Element ref from snapshot (e.g. @e2) or CSS selector or text to click",
  }),
});

export function createClickTool(browserFn: BrowserFn = defaultBrowserFn): AgentTool<typeof ClickParams> {
  return {
    name: "browser_click",
    description: "Click an element on the page.",
    label: "Clicking element",
    parameters: ClickParams,
    execute: async (_id, { selector }) => {
      const out = await browserFn(`click "${selector}"`);
      return textResult(out || "Clicked");
    },
  };
}

export const clickTool = createClickTool();

// ─── Tool: fill ───────────────────────────────────────────────────────────────

const FillParams = Type.Object({
  selector: Type.String({ description: "Element ref or CSS selector" }),
  text: Type.String({ description: "Text to fill into the element" }),
});

export function createFillTool(browserFn: BrowserFn = defaultBrowserFn): AgentTool<typeof FillParams> {
  return {
    name: "browser_fill",
    description: "Clear and fill a form field with text.",
    label: "Filling input",
    parameters: FillParams,
    execute: async (_id, { selector, text }) => {
      const out = await browserFn(`fill "${selector}" "${text}"`);
      return textResult(out || "Filled");
    },
  };
}

export const fillTool = createFillTool();

// ─── Tool: eval ───────────────────────────────────────────────────────────────

const EvalParams = Type.Object({
  js: Type.String({
    description: "JavaScript expression to evaluate in the browser context",
  }),
});

export function createEvalTool(browserFn: BrowserFn = defaultBrowserFn): AgentTool<typeof EvalParams> {
  return {
    name: "browser_eval",
    description:
      "Run JavaScript in the browser and return the result as a string.",
    label: "Running JS",
    parameters: EvalParams,
    execute: async (_id, { js }) => {
      const escaped = js.replace(/'/g, `'\\''`);
      const out = await browserFn(`eval '${escaped}'`);
      return textResult(out);
    },
  };
}

export const evalTool = createEvalTool();

// ─── Tool: screenshot ────────────────────────────────────────────────────────

const ScreenshotParams = Type.Object({
  path: Type.Optional(
    Type.String({ description: "File path to save screenshot (optional)" })
  ),
});

export function createScreenshotTool(browserFn: BrowserFn = defaultBrowserFn): AgentTool<typeof ScreenshotParams> {
  return {
    name: "browser_screenshot",
    description: "Take a screenshot of the current page.",
    label: "Taking screenshot",
    parameters: ScreenshotParams,
    execute: async (_id, { path }) => {
      const arg = path ? ` "${path}"` : "";
      const out = await browserFn(`screenshot${arg}`);
      return textResult(out || "Screenshot taken");
    },
  };
}

export const screenshotTool = createScreenshotTool();

// ─── Tool: wait ───────────────────────────────────────────────────────────────

const WaitParams = Type.Object({
  target: Type.String({
    description:
      "CSS selector to wait for, or number of milliseconds (e.g. '1000'), or '--load networkidle'",
  }),
});

export function createWaitTool(browserFn: BrowserFn = defaultBrowserFn): AgentTool<typeof WaitParams> {
  return {
    name: "browser_wait",
    description: "Wait for an element to appear, a condition, or a time period.",
    label: "Waiting",
    parameters: WaitParams,
    execute: async (_id, { target }) => {
      const out = await browserFn(`wait ${target}`);
      return textResult(out || "Wait complete");
    },
  };
}

export const waitTool = createWaitTool();

// ─── Tool: get_datalayer ─────────────────────────────────────────────────────

const GetDataLayerParams = Type.Object({
  from_index: Type.Optional(
    Type.Number({
      description:
        "Return only events from this index onwards (to get new events since last check). Defaults to 0 (all events).",
    })
  ),
});

export function createGetDataLayerTool(browserFn: BrowserFn = defaultBrowserFn): AgentTool<typeof GetDataLayerParams> {
  return {
    name: "get_datalayer",
    description:
      "Get the current contents of window.dataLayer from the browser. Returns JSON array of all dataLayer pushes.",
    label: "Reading dataLayer",
    parameters: GetDataLayerParams,
    execute: async (_id, { from_index }) => {
      const idx = from_index ?? 0;
      const js = `JSON.stringify((window.dataLayer || []).slice(${idx}))`;
      const escaped = js.replace(/'/g, `'\\''`);
      const out = await browserFn(`eval '${escaped}'`);
      return textResult(out || "[]");
    },
  };
}

export const getDataLayerTool = createGetDataLayerTool();

export function createAccumulatingGetDataLayerTool(
  accumulator: unknown[],
  browserFn: BrowserFn = defaultBrowserFn,
): AgentTool<typeof GetDataLayerParams> {
  const base = createGetDataLayerTool(browserFn);
  return {
    ...base,
    execute: async (id, args) => {
      const result = await base.execute(id, args);
      const text = (result.content[0] as { type: string; text: string }).text || "[]";
      try {
        // agent-browser eval double-encodes string results — same logic as captureDataLayer
        const parsed = JSON.parse(text);
        const events = typeof parsed === "string" ? JSON.parse(parsed) : parsed;
        if (Array.isArray(events)) accumulator.push(...events);
      } catch { /* non-fatal */ }
      return result;
    },
  };
}

// ─── Tool: request_human_input ───────────────────────────────────────────────

type ReadLineFn = (prompt: string) => Promise<string>;
type WriteErrFn = (s: string) => void;

async function defaultReadLine(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    // Non-interactive environment — auto-continue so the agent can proceed
    return "";
  }
  const { createInterface } = await import("readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await rl.question(prompt);
  rl.close();
  return answer;
}

const RequestHumanInputParams = Type.Object({
  message: Type.String({
    description: "Describe what you need the user to do in the browser (e.g. 'Please enter payment details and click Confirm').",
  }),
});

export function createRequestHumanInputTool(
  readLineFn: ReadLineFn = defaultReadLine,
  writeErr: WriteErrFn = (s) => process.stderr.write(s),
): AgentTool<typeof RequestHumanInputParams> {
  return {
    name: "request_human_input",
    description: "Pause and ask the human to complete an action in the browser (e.g. enter payment info, solve a CAPTCHA, log in). The agent resumes after the human presses Enter.",
    label: "Waiting for human",
    parameters: RequestHumanInputParams,
    execute: async (_id, { message }) => {
      const url = await defaultBrowserFn("eval 'window.location.href'").catch(() => "");

      writeErr(`\n  ⏸  Agent needs your help:\n  ${message}\n`);
      if (url) writeErr(`  Browser is at: ${url}\n`);
      writeErr(`  Complete the action in the browser window, then press Enter.\n`);

      await readLineFn("  Press Enter when done... ");
      return textResult("Human has completed the requested action. You may continue.");
    },
  };
}

export const requestHumanInputTool = createRequestHumanInputTool();

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

export function createFindTool(browserFn: BrowserFn = defaultBrowserFn): AgentTool<typeof FindParams> {
  return {
    name: "browser_find",
    description:
      "Find an element by role, text, label, placeholder, or test ID and perform an action on it.",
    label: "Finding element",
    parameters: FindParams,
    execute: async (_id, { locator, value, action, fill_text }) => {
      const extra = action === "fill" && fill_text ? ` "${fill_text}"` : "";
      const out = await browserFn(
        `find ${locator} "${value}" ${action}${extra}`
      );
      return textResult(out || "Done");
    },
  };
}

export const findTool = createFindTool();

// ─── createAllTools ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAllTools(browserFn: BrowserFn = defaultBrowserFn): AgentTool<any>[] {
  return [
    createNavigateTool(browserFn),
    createSnapshotTool(browserFn),
    createClickTool(browserFn),
    createFillTool(browserFn),
    createFindTool(browserFn),
    createEvalTool(browserFn),
    createWaitTool(browserFn),
    createGetDataLayerTool(browserFn),
    createScreenshotTool(browserFn),
    requestHumanInputTool,
  ];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const allTools: AgentTool<any>[] = createAllTools();
