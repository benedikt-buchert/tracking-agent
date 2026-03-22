import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TaskList } from "../agent/task-list.js";
import {
  DATA_LAYER_BRIDGE_STORAGE_KEY,
  defaultBrowserFn,
  captureDataLayer,
  drainInterceptor,
  mergeUniqueEvents,
  runBrowserEval,
  parseBrowserJsonArray,
} from "./runner.js";
import type { BrowserFn } from "./runner.js";

function textResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

// ─── Tool: navigate ──────────────────────────────────────────────────────────

const NavigateParams = Type.Object({
  url: Type.String({ description: "Full URL to navigate to" }),
});

export function createNavigateTool(
  browserFn: BrowserFn = defaultBrowserFn,
): AgentTool<typeof NavigateParams> {
  return {
    name: "browser_navigate",
    description:
      "Open a URL in the browser. Wait for the page to be idle after navigation.",
    label: "Navigating browser",
    parameters: NavigateParams,
    execute: async (_id, { url }) => {
      const navOut = await browserFn(["open", url]);
      const waitOut = await browserFn(["wait", "--load", "networkidle"]);
      const out = waitOut || navOut;
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
    }),
  ),
});

export function createSnapshotTool(
  browserFn: BrowserFn = defaultBrowserFn,
): AgentTool<typeof SnapshotParams> {
  return {
    name: "browser_snapshot",
    description:
      "Get the accessibility tree of the current page. Returns element refs (e.g. @e1, @e2) that you can use with other tools.",
    label: "Taking snapshot",
    parameters: SnapshotParams,
    execute: async (_id, { interactive_only }) => {
      const args = interactive_only ? ["snapshot", "-i"] : ["snapshot"];
      const out = await browserFn(args);
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

export function createClickTool(
  browserFn: BrowserFn = defaultBrowserFn,
): AgentTool<typeof ClickParams> {
  return {
    name: "browser_click",
    description: "Click an element on the page.",
    label: "Clicking element",
    parameters: ClickParams,
    execute: async (_id, { selector }) => {
      const out = await browserFn(["click", selector]);
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

export function createFillTool(
  browserFn: BrowserFn = defaultBrowserFn,
): AgentTool<typeof FillParams> {
  return {
    name: "browser_fill",
    description: "Clear and fill a form field with text.",
    label: "Filling input",
    parameters: FillParams,
    execute: async (_id, { selector, text }) => {
      const out = await browserFn(["fill", selector, text]);
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

export function createEvalTool(
  browserFn: BrowserFn = defaultBrowserFn,
): AgentTool<typeof EvalParams> {
  return {
    name: "browser_eval",
    description:
      "Run JavaScript in the browser and return the result as a string.",
    label: "Running JS",
    parameters: EvalParams,
    execute: async (_id, { js }) => {
      const out = await runBrowserEval(js, browserFn);
      return textResult(out);
    },
  };
}

export const evalTool = createEvalTool();

// ─── Tool: screenshot ────────────────────────────────────────────────────────

const ScreenshotParams = Type.Object({
  path: Type.Optional(
    Type.String({ description: "File path to save screenshot (optional)" }),
  ),
});

export function createScreenshotTool(
  browserFn: BrowserFn = defaultBrowserFn,
): AgentTool<typeof ScreenshotParams> {
  return {
    name: "browser_screenshot",
    description: "Take a screenshot of the current page.",
    label: "Taking screenshot",
    parameters: ScreenshotParams,
    execute: async (_id, { path }) => {
      const out = await browserFn(path ? ["screenshot", path] : ["screenshot"]);
      return textResult(out || "Screenshot taken");
    },
  };
}

export const screenshotTool = createScreenshotTool();

// ─── Tool: wait ───────────────────────────────────────────────────────────────

const WaitParams = Type.Object({
  target: Type.Optional(
    Type.String({
      description:
        "Deprecated compatibility form for waits (e.g. selector, '1000', or '--load networkidle')",
    }),
  ),
  selector: Type.Optional(
    Type.String({
      description: "CSS selector to wait for",
    }),
  ),
  ms: Type.Optional(
    Type.Number({
      description: "Milliseconds to wait",
    }),
  ),
  load: Type.Optional(
    Type.Union([Type.Literal("networkidle")], {
      description: "Page load state to wait for",
    }),
  ),
});

export function createWaitTool(
  browserFn: BrowserFn = defaultBrowserFn,
): AgentTool<typeof WaitParams> {
  return {
    name: "browser_wait",
    description:
      "Wait for an element to appear, a condition, or a time period.",
    label: "Waiting",
    parameters: WaitParams,
    execute: async (_id, { target, selector, ms, load }) => {
      const args = load
        ? ["wait", "--load", load]
        : selector
          ? ["wait", selector]
          : target?.startsWith("--load ")
            ? ["wait", "--load", target.slice("--load ".length)]
            : ["wait", String(target ?? ms ?? 0)];
      const out = await browserFn(args);
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
    }),
  ),
});

export function createGetDataLayerTool(
  browserFn: BrowserFn = defaultBrowserFn,
): AgentTool<typeof GetDataLayerParams> {
  return {
    name: "get_datalayer",
    description:
      "Get the current contents of window.dataLayer from the browser. Returns JSON array of all dataLayer pushes.",
    label: "Reading dataLayer",
    parameters: GetDataLayerParams,
    execute: async (_id, { from_index }) => {
      const idx = from_index ?? 0;
      const js = `JSON.stringify((window.dataLayer || []).slice(${idx}))`;
      const out = await runBrowserEval(js, browserFn);
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
      const text =
        (result.content[0] as { type: string; text: string }).text || "[]";
      try {
        accumulator.push(...parseBrowserJsonArray(text));
      } catch {
        /* non-fatal */
      }
      return result;
    },
  };
}

// ─── Tool: request_human_input ───────────────────────────────────────────────

type ReadLineFn = (prompt: string) => Promise<string>;
type WriteErrFn = (s: string) => void;
type ResolveCurrentUrlFn = () => Promise<string>;

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
    description:
      "Describe what you need the user to do in the browser (e.g. 'Please enter payment details and click Confirm').",
  }),
});

export function createRequestHumanInputTool(
  readLineFn: ReadLineFn = defaultReadLine,
  writeErr: WriteErrFn = (s) => process.stderr.write(s),
  resolveCurrentUrl: ResolveCurrentUrlFn = async () => "",
): AgentTool<typeof RequestHumanInputParams> {
  return {
    name: "request_human_input",
    description:
      "Pause and ask the human to complete an action in the browser (e.g. enter payment info, solve a CAPTCHA, log in). The agent resumes after the human presses Enter.",
    label: "Waiting for human",
    parameters: RequestHumanInputParams,
    execute: async (_id, { message }) => {
      const url = await resolveCurrentUrl().catch(() => "");

      writeErr(`\n  ⏸  Agent needs your help:\n  ${message}\n`);
      if (url) writeErr(`  Browser is at: ${url}\n`);
      writeErr(
        `  Complete the action in the browser window, then press Enter.\n`,
      );

      await readLineFn("  Press Enter when done... ");
      return textResult(
        "Human has completed the requested action. You may continue.",
      );
    },
  };
}

export const requestHumanInputTool = createRequestHumanInputTool(
  defaultReadLine,
  (s) => process.stderr.write(s),
  () => runBrowserEval("window.location.href", defaultBrowserFn),
);

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
    { description: "How to locate the element" },
  ),
  value: Type.String({ description: "Value to search for" }),
  action: Type.Union([Type.Literal("click"), Type.Literal("fill")], {
    description: "Action to perform on the found element",
  }),
  fill_text: Type.Optional(
    Type.String({ description: "Text to fill (required when action is fill)" }),
  ),
});

export function createFindTool(
  browserFn: BrowserFn = defaultBrowserFn,
): AgentTool<typeof FindParams> {
  return {
    name: "browser_find",
    description:
      "Find an element by role, text, label, placeholder, or test ID and perform an action on it.",
    label: "Finding element",
    parameters: FindParams,
    execute: async (_id, { locator, value, action, fill_text }) => {
      if (locator === "testid") {
        const result = await executeTestIdDomAction(
          browserFn,
          value,
          action,
          fill_text,
        );
        return textResult(result.text || "Done", {
          capturedEvents: result.capturedEvents,
          timingRiskWarning: result.capturedEvents.length > 0,
        });
      }

      const args = ["find", locator, value, action];
      if (action === "fill" && fill_text) args.push(fill_text);
      const out = await browserFn(args);
      return textResult(out || "Done");
    },
  };
}

async function executeTestIdDomAction(
  browserFn: BrowserFn,
  value: string,
  action: "click" | "fill",
  fillText?: string,
): Promise<{ text: string; capturedEvents: unknown[] }> {
  const selector = `[data-testid=${JSON.stringify(value)}]`;
  const js =
    action === "click"
      ? [
          "(() => {",
          "  const capturedEvents = [];",
          `  const element = document.querySelector(${JSON.stringify(selector)});`,
          "  if (!element) return JSON.stringify({ text: '✗ Element not found. Verify the selector is correct and the element exists in the DOM.', capturedEvents });",
          `  const storageKey = ${JSON.stringify(DATA_LAYER_BRIDGE_STORAGE_KEY)};`,
          "  const dl = Array.isArray(window.dataLayer) ? window.dataLayer : (window.dataLayer = []);",
          "  const originalPush = typeof dl.push === 'function' ? dl.push.bind(dl) : Array.prototype.push.bind(dl);",
          "  dl.push = function() {",
          "    for (let i = 0; i < arguments.length; i++) {",
          "      capturedEvents.push(arguments[i]);",
          "      if (!window.__dl_intercepted) {",
          "        const persisted = JSON.parse(sessionStorage.getItem(storageKey) || '[]');",
          "        persisted.push(arguments[i]);",
          "        sessionStorage.setItem(storageKey, JSON.stringify(persisted));",
          "      }",
          "    }",
          "    return originalPush(...arguments);",
          "  };",
          "  if (element instanceof HTMLElement) element.click();",
          "  else element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));",
          "  return JSON.stringify({ text: '✓ Done', capturedEvents });",
          "})()",
        ].join(" ")
      : [
          "(() => {",
          `  const element = document.querySelector(${JSON.stringify(selector)});`,
          "  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {",
          "    return JSON.stringify({ text: '✗ Element not found. Verify the selector is correct and the element exists in the DOM.', capturedEvents: [] });",
          "  }",
          `  element.value = ${JSON.stringify(fillText ?? "")};`,
          "  element.dispatchEvent(new Event('input', { bubbles: true }));",
          "  element.dispatchEvent(new Event('change', { bubbles: true }));",
          "  return JSON.stringify({ text: '✓ Done', capturedEvents: [] });",
          "})()",
        ].join(" ");

  const out = await runBrowserEval(js, browserFn);
  try {
    const parsed = JSON.parse(out.trim().replace(/^"|"$/g, ""));
    if (parsed !== null && typeof parsed === "object") {
      return {
        text:
          typeof (parsed as Record<string, unknown>)["text"] === "string"
            ? ((parsed as Record<string, unknown>)["text"] as string)
            : "Done",
        capturedEvents: Array.isArray(
          (parsed as Record<string, unknown>)["capturedEvents"],
        )
          ? ((parsed as Record<string, unknown>)["capturedEvents"] as unknown[])
          : [],
      };
    }
  } catch {
    /* fall through */
  }
  return { text: out.trim().replace(/^"|"$/g, ""), capturedEvents: [] };
}

export const findTool = createFindTool();

// ─── Tool: skip_task ──────────────────────────────────────────────────────────

const SkipTaskParams = Type.Object({
  event_name: Type.String({
    description: "The event name to mark as impossible to trigger",
  }),
  reason: Type.String({
    description:
      "Why this event cannot be triggered — what you tried and why it is not available",
  }),
});

export function createSkipTaskTool(
  taskList: TaskList,
): AgentTool<typeof SkipTaskParams> {
  return {
    name: "skip_task",
    description:
      "Mark an expected event as impossible to trigger on this site. Only call this after genuinely exhausting all reasonable attempts: navigating to relevant pages, trying different interactions, looking for hidden triggers. You must provide a clear reason.",
    label: "Skipping task",
    parameters: SkipTaskParams,
    execute: async (_id, { event_name, reason }) => {
      taskList.skip(event_name, reason);
      return textResult(`Marked ${event_name} as skipped: ${reason}`);
    },
  };
}

// ─── createDataLayerPoller ────────────────────────────────────────────────────
//
// Returns a wrapper function that, after any wrapped tool executes, automatically
// captures new dataLayer events and appends them to `accumulator`. The shared
// `lastIndex` ensures each call only picks up events added since the previous poll.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = AgentTool<any>;

type SleepFn = (ms: number) => Promise<void>;
interface DataLayerInterceptorOptions {
  settleMs?: number;
  /** @deprecated No longer used — settle is a single sleep + drain. Kept for API compat. */
  settleIntervalMs?: number;
  sleepFn?: SleepFn;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldWaitForDelayedEvents(toolName: string, args: unknown): boolean {
  if (toolName === "browser_click") return true;
  if (toolName !== "browser_find") return false;
  if (args === null || typeof args !== "object") return false;
  return (args as Record<string, unknown>)["action"] === "click";
}

export function createDataLayerPoller(
  accumulator: unknown[],
  browserFn: BrowserFn = defaultBrowserFn,
): (tool: AnyTool) => AnyTool {
  let lastIndex = 0;
  return (tool: AnyTool): AnyTool => ({
    ...tool,
    execute: async (id: string, args: unknown) => {
      const result = await tool.execute(id, args);
      try {
        const newEvents = await captureDataLayer(lastIndex, browserFn);
        lastIndex += newEvents.length;
        accumulator.push(...newEvents);
      } catch {
        /* non-fatal */
      }
      return result;
    },
  });
}

// ─── createDataLayerInterceptor ───────────────────────────────────────────────
//
// Like createDataLayerPoller but uses the JS-level dataLayer interceptor instead
// of polling by index. After each wrapped tool executes, drains the interceptor
// buffer — auto-installing on new pages so cross-navigation events are captured
// without any index tracking.

export function createDataLayerInterceptor(
  accumulator: unknown[],
  browserFn: BrowserFn = defaultBrowserFn,
  {
    settleMs = 300,
    sleepFn = defaultSleep,
  }: DataLayerInterceptorOptions = {},
): (tool: AnyTool) => AnyTool {
  const appendUniqueEvents = (events: unknown[]) => {
    if (events.length === 0) return;
    const merged = mergeUniqueEvents(accumulator, events);
    accumulator.splice(0, accumulator.length, ...merged);
  };

  const drainIntoAccumulator = async () => {
    try {
      const newEvents = await drainInterceptor(browserFn);
      appendUniqueEvents(newEvents);
    } catch {
      /* non-fatal */
    }
  };

  return (tool: AnyTool): AnyTool => ({
    ...tool,
    execute: async (id: string, args: unknown) => {
      const result = await tool.execute(id, args);
      const capturedEvents = Array.isArray(result.details?.["capturedEvents"])
        ? (result.details["capturedEvents"] as unknown[])
        : [];
      if (capturedEvents.length > 0) {
        appendUniqueEvents(capturedEvents);
      }
      if (settleMs > 0 && shouldWaitForDelayedEvents(tool.name, args)) {
        await sleepFn(settleMs);
      }
      await drainIntoAccumulator();
      return result;
    },
  });
}

// ─── createAllTools ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAllTools(
  browserFn: BrowserFn = defaultBrowserFn,
): AnyTool[] {
  const requestHumanInput = createRequestHumanInputTool(
    defaultReadLine,
    (s) => process.stderr.write(s),
    () => runBrowserEval("window.location.href", browserFn),
  );
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
    requestHumanInput,
  ];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const allTools: AgentTool<any>[] = createAllTools();
