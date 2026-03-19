import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BrowserFn } from "./runner.js";
import {
  navigateTool,
  snapshotTool,
  clickTool,
  fillTool,
  evalTool,
  waitTool,
  getDataLayerTool,
  createAccumulatingGetDataLayerTool,
  findTool,
  createRequestHumanInputTool,
  allTools,
  createNavigateTool,
  createSnapshotTool,
  createClickTool,
  createFillTool,
  createEvalTool,
  createWaitTool,
  createGetDataLayerTool,
  createScreenshotTool,
  createFindTool,
  createAllTools,
  createDataLayerPoller,
  createDataLayerInterceptor,
} from "./tools.js";

function mockBrowser(response = "ok"): BrowserFn {
  return vi.fn().mockResolvedValue(response) as unknown as BrowserFn;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── allTools ─────────────────────────────────────────────────────────────────
describe("allTools", () => {
  it("exports all tools in a single array", () => {
    expect(allTools).toHaveLength(10);
  });

  it("every tool has name, description, label, parameters, and execute", () => {
    for (const tool of allTools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.label).toBeTruthy();
      expect(tool.parameters).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("does not include fetch_schema — schema discovery is deterministic code", () => {
    const names = allTools.map((t) => t.name);
    expect(names).not.toContain("fetch_schema");
  });
});

// ─── createNavigateTool ───────────────────────────────────────────────────────
describe("createNavigateTool", () => {
  it("calls the injected browserFn with the URL", async () => {
    const browserFn = mockBrowser();
    const tool = createNavigateTool(browserFn);
    await tool.execute("1", { url: "https://example.com" });
    expect(browserFn).toHaveBeenCalledWith(["open", "https://example.com"]);
  });

  it("waits for networkidle after navigation", async () => {
    const browserFn = mockBrowser();
    const tool = createNavigateTool(browserFn);
    await tool.execute("1", { url: "https://example.com" });
    expect(browserFn).toHaveBeenCalledWith(["wait", "--load", "networkidle"]);
  });

  it("returns agent-browser output as text", async () => {
    const tool = createNavigateTool(mockBrowser("Navigation complete"));
    const result = await tool.execute("1", { url: "https://foo.com" });
    expect((result.content[0] as { text: string }).text).toBe(
      "Navigation complete",
    );
  });

  it("returns fallback message when output is empty", async () => {
    const tool = createNavigateTool(mockBrowser(""));
    const result = await tool.execute("1", { url: "https://foo.com" });
    expect((result.content[0] as { text: string }).text).toBe(
      "Navigated successfully",
    );
    expect(result).toEqual({
      content: [{ type: "text", text: "Navigated successfully" }],
      details: {},
    });
  });
});

// keep the default export consistent
describe("navigateTool", () => {
  it("has the correct name", () => {
    expect(navigateTool.name).toBe("browser_navigate");
  });
});

// ─── createSnapshotTool ───────────────────────────────────────────────────────
describe("createSnapshotTool", () => {
  it("calls snapshot without -i flag by default", async () => {
    const browserFn = mockBrowser("tree");
    const tool = createSnapshotTool(browserFn);
    await tool.execute("1", {});
    expect(browserFn).toHaveBeenCalledWith(["snapshot"]);
  });

  it("adds -i flag when interactive_only is true", async () => {
    const browserFn = mockBrowser("tree");
    const tool = createSnapshotTool(browserFn);
    await tool.execute("1", { interactive_only: true });
    expect(browserFn).toHaveBeenCalledWith(["snapshot", "-i"]);
  });

  it("returns snapshot output", async () => {
    const tool = createSnapshotTool(mockBrowser("- button @e1\n- link @e2"));
    const result = await tool.execute("1", {});
    expect(result).toEqual({
      content: [{ type: "text", text: "- button @e1\n- link @e2" }],
      details: {},
    });
  });
});

describe("snapshotTool", () => {
  it("has the correct name", () => {
    expect(snapshotTool.name).toBe("browser_snapshot");
  });
});

// ─── createClickTool ──────────────────────────────────────────────────────────
describe("createClickTool", () => {
  it("calls browserFn with click and the selector", async () => {
    const browserFn = mockBrowser("clicked");
    const tool = createClickTool(browserFn);
    await tool.execute("1", { selector: "@e3" });
    expect(browserFn).toHaveBeenCalledWith(["click", "@e3"]);
  });

  it("returns fallback when output is empty", async () => {
    const tool = createClickTool(mockBrowser(""));
    const result = await tool.execute("1", { selector: "@e3" });
    expect(result).toEqual({
      content: [{ type: "text", text: "Clicked" }],
      details: {},
    });
  });

  it("returns browser error output as text", async () => {
    const tool = createClickTool(mockBrowser("Error: element not found: @e99"));
    const result = await tool.execute("1", { selector: "@e99" });
    expect((result.content[0] as { text: string }).text).toContain(
      "element not found",
    );
  });
});

describe("clickTool", () => {
  it("has the correct name", () => {
    expect(clickTool.name).toBe("browser_click");
  });
});

// ─── createFillTool ───────────────────────────────────────────────────────────
describe("createFillTool", () => {
  it("calls browserFn with fill, selector, and text", async () => {
    const browserFn = mockBrowser("filled");
    const tool = createFillTool(browserFn);
    await tool.execute("1", { selector: "@e1", text: "hello" });
    expect(browserFn).toHaveBeenCalledWith(["fill", "@e1", "hello"]);
  });

  it("returns fallback when output is empty", async () => {
    const tool = createFillTool(mockBrowser(""));
    const result = await tool.execute("1", { selector: "@e1", text: "hello" });
    expect(result).toEqual({
      content: [{ type: "text", text: "Filled" }],
      details: {},
    });
  });
});

describe("fillTool", () => {
  it("has the correct name", () => {
    expect(fillTool.name).toBe("browser_fill");
  });
});

// ─── createEvalTool ───────────────────────────────────────────────────────────
describe("createEvalTool", () => {
  it("calls browserFn with the JS expression", async () => {
    const browserFn = mockBrowser("42");
    const tool = createEvalTool(browserFn);
    const result = await tool.execute("1", { js: "1 + 1" });
    expect(browserFn).toHaveBeenCalledWith(["eval", "1 + 1"]);
    expect((result.content[0] as { text: string }).text).toBe("42");
  });

  it("returns exact text-result shape", async () => {
    const tool = createEvalTool(mockBrowser("ok"));
    const result = await tool.execute("1", { js: "1 + 1" });
    expect(result).toEqual({
      content: [{ type: "text", text: "ok" }],
      details: {},
    });
  });
});

describe("evalTool", () => {
  it("has the correct name", () => {
    expect(evalTool.name).toBe("browser_eval");
  });
});

// ─── createWaitTool ───────────────────────────────────────────────────────────
describe("createWaitTool", () => {
  it("calls browserFn with wait and the target", async () => {
    const browserFn = mockBrowser("done");
    const tool = createWaitTool(browserFn);
    await tool.execute("1", { ms: 1000 });
    expect(browserFn).toHaveBeenCalledWith(["wait", "1000"]);
  });

  it("uses structured load-state parameters", async () => {
    const browserFn = mockBrowser("done");
    const tool = createWaitTool(browserFn);
    await tool.execute("1", { load: "networkidle" });
    expect(browserFn).toHaveBeenCalledWith(["wait", "--load", "networkidle"]);
  });

  it("passes a selector wait through as a single argv item", async () => {
    const browserFn = mockBrowser("done");
    const tool = createWaitTool(browserFn);
    await tool.execute("1", { selector: ".checkout button" });
    expect(browserFn).toHaveBeenCalledWith(["wait", ".checkout button"]);
  });

  it("supports legacy target load-state syntax", async () => {
    const browserFn = mockBrowser("done");
    const tool = createWaitTool(browserFn);
    await tool.execute("1", { target: "--load networkidle" });
    expect(browserFn).toHaveBeenCalledWith(["wait", "--load", "networkidle"]);
  });

  it("falls back to target string when provided", async () => {
    const browserFn = mockBrowser("done");
    const tool = createWaitTool(browserFn);
    await tool.execute("1", { target: "#checkout" });
    expect(browserFn).toHaveBeenCalledWith(["wait", "#checkout"]);
  });

  it("returns fallback text when output is empty", async () => {
    const tool = createWaitTool(mockBrowser(""));
    const result = await tool.execute("1", { ms: 1000 });
    expect(result).toEqual({
      content: [{ type: "text", text: "Wait complete" }],
      details: {},
    });
  });

  it("prefers load over selector, target, and ms when multiple wait args exist", async () => {
    const browserFn = mockBrowser("done");
    const tool = createWaitTool(browserFn);
    await tool.execute("1", {
      load: "networkidle",
      selector: "#ready",
      target: "--load domcontentloaded",
      ms: 250,
    });
    expect(browserFn).toHaveBeenCalledWith(["wait", "--load", "networkidle"]);
  });

  it("prefers selector over legacy target and ms when load is absent", async () => {
    const browserFn = mockBrowser("done");
    const tool = createWaitTool(browserFn);
    await tool.execute("1", {
      selector: "#ready",
      target: "#fallback",
      ms: 250,
    });
    expect(browserFn).toHaveBeenCalledWith(["wait", "#ready"]);
  });

  it("falls back to zero milliseconds when no wait target is provided", async () => {
    const browserFn = mockBrowser("done");
    const tool = createWaitTool(browserFn);
    await tool.execute("1", {});
    expect(browserFn).toHaveBeenCalledWith(["wait", "0"]);
  });
});

describe("waitTool", () => {
  it("has the correct name", () => {
    expect(waitTool.name).toBe("browser_wait");
  });
});

// ─── createGetDataLayerTool ───────────────────────────────────────────────────
describe("createGetDataLayerTool", () => {
  it("evaluates window.dataLayer in the browser", async () => {
    const browserFn = mockBrowser('[{"event":"pageView"}]');
    const tool = createGetDataLayerTool(browserFn);
    const result = await tool.execute("1", {});
    expect(browserFn).toHaveBeenCalledWith([
      "eval",
      "JSON.stringify((window.dataLayer || []).slice(0))",
    ]);
    expect((result.content[0] as { text: string }).text).toBe(
      '[{"event":"pageView"}]',
    );
  });

  it("slices from from_index when provided", async () => {
    const browserFn = mockBrowser('[{"event":"click"}]');
    const tool = createGetDataLayerTool(browserFn);
    await tool.execute("1", { from_index: 3 });
    expect(browserFn).toHaveBeenCalledWith([
      "eval",
      "JSON.stringify((window.dataLayer || []).slice(3))",
    ]);
  });

  it("returns empty array string when browser returns nothing", async () => {
    const tool = createGetDataLayerTool(mockBrowser(""));
    const result = await tool.execute("1", {});
    expect(result).toEqual({
      content: [{ type: "text", text: "[]" }],
      details: {},
    });
  });
});

describe("getDataLayerTool", () => {
  it("has the correct name", () => {
    expect(getDataLayerTool.name).toBe("get_datalayer");
  });
});

// ─── createAccumulatingGetDataLayerTool ──────────────────────────────────────
describe("createAccumulatingGetDataLayerTool", () => {
  it("appends parsed events to the accumulator on each call", async () => {
    const events = [{ event: "page_view" }, { event: "purchase" }];
    const acc: unknown[] = [];
    const tool = createAccumulatingGetDataLayerTool(
      acc,
      mockBrowser(JSON.stringify(events)),
    );
    await tool.execute("1", {});
    expect(acc).toEqual(events);
  });

  it("handles double-encoded output from agent-browser", async () => {
    const events = [{ event: "add_to_cart" }];
    const acc: unknown[] = [];
    const tool = createAccumulatingGetDataLayerTool(
      acc,
      mockBrowser(JSON.stringify(JSON.stringify(events))),
    );
    await tool.execute("1", {});
    expect(acc).toEqual(events);
  });

  it("accumulates across multiple calls", async () => {
    const acc: unknown[] = [];
    const browserFn = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify([{ event: "page_view" }]))
      .mockResolvedValueOnce(
        JSON.stringify([{ event: "purchase" }]),
      ) as unknown as BrowserFn;
    const tool = createAccumulatingGetDataLayerTool(acc, browserFn);
    await tool.execute("1", {});
    await tool.execute("1", { from_index: 1 });
    expect(acc).toEqual([{ event: "page_view" }, { event: "purchase" }]);
  });

  it("still returns the raw tool result to the agent", async () => {
    const raw = JSON.stringify([{ event: "page_view" }]);
    const acc: unknown[] = [];
    const tool = createAccumulatingGetDataLayerTool(acc, mockBrowser(raw));
    const result = await tool.execute("1", {});
    expect((result.content[0] as { text: string }).text).toBe(raw);
  });

  it("does not throw when browser returns empty or invalid output", async () => {
    const acc: unknown[] = [];
    const tool = createAccumulatingGetDataLayerTool(acc, mockBrowser(""));
    await expect(tool.execute("1", {})).resolves.toBeDefined();
    expect(acc).toEqual([]);
  });
});

// ─── createScreenshotTool ─────────────────────────────────────────────────────
describe("createScreenshotTool", () => {
  it("calls browserFn with screenshot command", async () => {
    const browserFn = mockBrowser("screenshot taken");
    const tool = createScreenshotTool(browserFn);
    await tool.execute("1", {});
    expect(browserFn).toHaveBeenCalledWith(["screenshot"]);
  });

  it("passes the path argument when provided", async () => {
    const browserFn = mockBrowser("ok");
    const tool = createScreenshotTool(browserFn);
    await tool.execute("1", { path: "/tmp/shot.png" });
    expect(browserFn).toHaveBeenCalledWith(["screenshot", "/tmp/shot.png"]);
  });

  it("returns fallback when output is empty", async () => {
    const tool = createScreenshotTool(mockBrowser(""));
    const result = await tool.execute("1", {});
    expect(result).toEqual({
      content: [{ type: "text", text: "Screenshot taken" }],
      details: {},
    });
  });
});

// ─── createFindTool ───────────────────────────────────────────────────────────
describe("createFindTool", () => {
  it("uses direct DOM eval for click by testid", async () => {
    const browserFn = mockBrowser("✓ Done");
    const tool = createFindTool(browserFn);
    await tool.execute("1", {
      locator: "testid",
      value: "start-checkout",
      action: "click",
    });
    expect(browserFn).toHaveBeenCalledWith([
      "eval",
      expect.stringContaining("start-checkout"),
    ]);
    expect(browserFn).toHaveBeenCalledWith([
      "eval",
      expect.stringContaining("sessionStorage"),
    ]);
  });

  it("guards sessionStorage write with __dl_intercepted when interceptor is active", async () => {
    const browserFn = mockBrowser("✓ Done");
    const tool = createFindTool(browserFn);
    await tool.execute("1", {
      locator: "testid",
      value: "add-to-cart",
      action: "click",
    });
    const js = vi.mocked(browserFn).mock.calls[0][0][1] as string;
    // sessionStorage write must be conditional on interceptor not being installed,
    // so the same event is not written twice when drainInterceptor is also active
    expect(js).toMatch(/!window\.__dl_intercepted/);
    const sessionStorageIdx = js.indexOf("sessionStorage.setItem");
    const guardIdx = js.indexOf("!window.__dl_intercepted");
    expect(guardIdx).toBeLessThan(sessionStorageIdx);
  });

  it("uses direct DOM eval for fill by testid", async () => {
    const browserFn = mockBrowser("✓ Done");
    const tool = createFindTool(browserFn);
    await tool.execute("1", {
      locator: "testid",
      value: "email",
      action: "fill",
      fill_text: "buyer@example.com",
    });
    expect(browserFn).toHaveBeenCalledWith([
      "eval",
      expect.stringContaining("buyer@example.com"),
    ]);
  });

  it("builds correct command for click by role", async () => {
    const browserFn = mockBrowser("clicked");
    const tool = createFindTool(browserFn);
    await tool.execute("1", {
      locator: "role",
      value: "button",
      action: "click",
    });
    expect(browserFn).toHaveBeenCalledWith(["find", "role", "button", "click"]);
  });

  it("builds correct command for fill by label", async () => {
    const browserFn = mockBrowser("filled");
    const tool = createFindTool(browserFn);
    await tool.execute("1", {
      locator: "label",
      value: "Email",
      action: "fill",
      fill_text: "test@example.com",
    });
    expect(browserFn).toHaveBeenCalledWith([
      "find",
      "label",
      "Email",
      "fill",
      "test@example.com",
    ]);
  });

  it("does not append fill_text when the action is click", async () => {
    const browserFn = mockBrowser("clicked");
    const tool = createFindTool(browserFn);
    await tool.execute("1", {
      locator: "text",
      value: "Checkout",
      action: "click",
      fill_text: "ignored",
    });
    expect(browserFn).toHaveBeenCalledWith([
      "find",
      "text",
      "Checkout",
      "click",
    ]);
  });

  it("returns fallback when output is empty", async () => {
    const tool = createFindTool(mockBrowser(""));
    const result = await tool.execute("1", {
      locator: "text",
      value: "Checkout",
      action: "click",
    });
    expect(result).toEqual({
      content: [{ type: "text", text: "Done" }],
      details: {},
    });
  });

  it("does not append empty fill text for fill actions", async () => {
    const browserFn = mockBrowser("filled");
    const tool = createFindTool(browserFn);
    await tool.execute("1", {
      locator: "label",
      value: "Email",
      action: "fill",
      fill_text: "",
    });
    expect(browserFn).toHaveBeenCalledWith(["find", "label", "Email", "fill"]);
  });

  it("falls back to 'Done' when testid click returns empty text", async () => {
    const tool = createFindTool(
      mockBrowser(JSON.stringify({ text: "", capturedEvents: [] })),
    );
    const result = await tool.execute("1", {
      locator: "testid",
      value: "btn",
      action: "click",
    });
    expect((result.content[0] as { text: string }).text).toBe("Done");
  });

  it("sets timingRiskWarning true when testid click captures events", async () => {
    const event = { event: "add_to_cart" };
    const tool = createFindTool(
      mockBrowser(JSON.stringify({ text: "✓ Done", capturedEvents: [event] })),
    );
    const result = await tool.execute("1", {
      locator: "testid",
      value: "btn",
      action: "click",
    });
    expect(result.details["timingRiskWarning"]).toBe(true);
    expect(result.details["capturedEvents"]).toEqual([event]);
  });

  it("sets timingRiskWarning false when testid click captures no events", async () => {
    const tool = createFindTool(
      mockBrowser(JSON.stringify({ text: "✓ Done", capturedEvents: [] })),
    );
    const result = await tool.execute("1", {
      locator: "testid",
      value: "btn",
      action: "click",
    });
    expect(result.details["timingRiskWarning"]).toBe(false);
  });

  it("returns the raw JSON primitive string when browser eval returns a JSON number", async () => {
    const tool = createFindTool(mockBrowser("42"));
    const result = await tool.execute("1", {
      locator: "testid",
      value: "btn",
      action: "click",
    });
    expect((result.content[0] as { text: string }).text).toBe("42");
  });
});

describe("findTool", () => {
  it("has the correct name", () => {
    expect(findTool.name).toBe("browser_find");
  });
});

// ─── createAllTools ───────────────────────────────────────────────────────────
describe("createAllTools", () => {
  it("returns tools that use the injected browserFn", async () => {
    const browserFn = mockBrowser("ok");
    const tools = createAllTools(browserFn);
    const navigate = tools.find((t) => t.name === "browser_navigate")!;
    await navigate.execute("1", { url: "https://example.com" });
    expect(browserFn).toHaveBeenCalled();
  });

  it("builds request_human_input with the injected browserFn", async () => {
    const browserFn = mockBrowser("https://example.com/current");
    const tools = createAllTools(browserFn);
    const requestHumanInput = tools.find(
      (t) => t.name === "request_human_input",
    )!;
    await requestHumanInput.execute("1", { message: "Continue manually" });
    expect(browserFn).toHaveBeenCalledWith(["eval", "window.location.href"]);
  });

  it("returns the same number of tools as allTools", () => {
    expect(createAllTools(mockBrowser())).toHaveLength(allTools.length);
  });
});

// ─── requestHumanInputTool ────────────────────────────────────────────────────

describe("requestHumanInputTool", () => {
  it("writes the agent message to the err stream", async () => {
    const written: string[] = [];
    const readLineFn = vi.fn().mockResolvedValue("");
    const tool = createRequestHumanInputTool(readLineFn, (s) =>
      written.push(s),
    );
    await tool.execute("1", { message: "Please log in first" });
    expect(written.join("")).toContain("Please log in first");
  });

  it("calls readLineFn to wait for the user to press Enter", async () => {
    const readLineFn = vi.fn().mockResolvedValue("");
    const tool = createRequestHumanInputTool(readLineFn, () => {});
    await tool.execute("1", { message: "Enter details" });
    expect(readLineFn).toHaveBeenCalledOnce();
  });

  it("returns a message indicating the agent may continue", async () => {
    const readLineFn = vi.fn().mockResolvedValue("");
    const tool = createRequestHumanInputTool(readLineFn, () => {});
    const result = await tool.execute("1", {
      message: "Enter payment details",
    });
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "Human has completed the requested action. You may continue.",
        },
      ],
      details: {},
    });
  });

  it("includes the current URL when available", async () => {
    const written: string[] = [];
    const tool = createRequestHumanInputTool(
      vi.fn().mockResolvedValue(""),
      (s) => written.push(s),
      async () => "https://example.com/checkout",
    );
    await tool.execute("1", { message: "Continue manually" });
    expect(written.join("")).toContain("https://example.com/checkout");
  });

  it("omits the current URL line when URL resolution fails", async () => {
    const written: string[] = [];
    const tool = createRequestHumanInputTool(
      vi.fn().mockResolvedValue(""),
      (s) => written.push(s),
      async () => {
        throw new Error("no url");
      },
    );
    await tool.execute("1", { message: "Continue manually" });
    expect(written.join("")).not.toContain("Browser is at:");
  });

  it("is included in allTools", () => {
    const names = allTools.map((t) => t.name);
    expect(names).toContain("request_human_input");
  });
});

// ─── createDataLayerInterceptor ───────────────────────────────────────────────

describe("createDataLayerInterceptor", () => {
  const noSettle = { settleMs: 0 };

  it("does not append to accumulator when tool result capturedEvents is empty", async () => {
    const acc: unknown[] = [];
    const interceptBrowserFn = vi
      .fn()
      .mockResolvedValue("[]") as unknown as BrowserFn;
    const intercept = createDataLayerInterceptor(acc, interceptBrowserFn, noSettle);
    const tool = intercept({
      name: "browser_find",
      description: "",
      label: "",
      parameters: {} as never,
      execute: async () => ({
        content: [{ type: "text" as const, text: "ok" }],
        details: { capturedEvents: [] },
      }),
    });

    await tool.execute("1", {});

    expect(acc).toHaveLength(0);
  });

  it("appends to accumulator when tool result capturedEvents is non-empty", async () => {
    const acc: unknown[] = [];
    const event = { event: "add_to_cart" };
    const interceptBrowserFn = vi
      .fn()
      .mockResolvedValue("[]") as unknown as BrowserFn;
    const intercept = createDataLayerInterceptor(acc, interceptBrowserFn, noSettle);
    const tool = intercept({
      name: "browser_find",
      description: "",
      label: "",
      parameters: {} as never,
      execute: async () => ({
        content: [{ type: "text" as const, text: "ok" }],
        details: { capturedEvents: [event] },
      }),
    });

    await tool.execute("1", {});

    expect(acc).toEqual([event]);
  });

  it("drains events both before and after a wrapped tool executes", async () => {
    const acc: unknown[] = [];
    const interceptBrowserFn = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify([{ event: "before" }]))
      .mockResolvedValueOnce(JSON.stringify([{ event: "after" }]))
      .mockResolvedValueOnce(JSON.stringify([])) as unknown as BrowserFn;
    const intercept = createDataLayerInterceptor(
      acc,
      interceptBrowserFn,
      noSettle,
    );
    const tool = intercept(createClickTool(mockBrowser("ok")));

    await tool.execute("1", { selector: "@e1" });

    expect(acc).toEqual([{ event: "before" }, { event: "after" }]);
  });

  it("appends drained events to accumulator after the wrapped tool executes", async () => {
    const acc: unknown[] = [];
    const events = [{ event: "page_view" }];
    const interceptBrowserFn = vi
      .fn()
      .mockResolvedValueOnce("[]")
      .mockResolvedValueOnce(JSON.stringify(events))
      .mockResolvedValueOnce("[]") as unknown as BrowserFn;
    const intercept = createDataLayerInterceptor(
      acc,
      interceptBrowserFn,
      noSettle,
    );
    const tool = intercept(createNavigateTool(mockBrowser("ok")));
    await tool.execute("1", { url: "https://example.com" });
    expect(acc).toEqual(events);
  });

  it("accumulates across multiple calls without double-counting", async () => {
    const acc: unknown[] = [];
    const interceptBrowserFn = vi
      .fn()
      .mockResolvedValueOnce("[]")
      .mockResolvedValueOnce(JSON.stringify([{ event: "page_view" }]))
      .mockResolvedValueOnce("[]")
      .mockResolvedValueOnce(
        JSON.stringify([{ event: "add_to_cart" }]),
      ) as unknown as BrowserFn;
    const intercept = createDataLayerInterceptor(
      acc,
      interceptBrowserFn,
      noSettle,
    );
    const tool = intercept(createNavigateTool(mockBrowser("ok")));
    await tool.execute("1", { url: "https://a.com" });
    await tool.execute("1", { url: "https://b.com" });
    expect(acc).toEqual([{ event: "page_view" }, { event: "add_to_cart" }]);
  });

  it("returns the original tool result unchanged", async () => {
    const acc: unknown[] = [];
    const intercept = createDataLayerInterceptor(
      acc,
      mockBrowser("[]"),
      noSettle,
    );
    const tool = intercept(
      createNavigateTool(mockBrowser("Navigation complete")),
    );
    const result = await tool.execute("1", { url: "https://example.com" });
    expect((result.content[0] as { text: string }).text).toBe(
      "Navigation complete",
    );
  });

  it("does not throw when drain fails", async () => {
    const acc: unknown[] = [];
    const failingBrowserFn = vi
      .fn()
      .mockRejectedValue(new Error("timeout")) as unknown as BrowserFn;
    const intercept = createDataLayerInterceptor(
      acc,
      failingBrowserFn,
      noSettle,
    );
    const tool = intercept(createNavigateTool(mockBrowser("ok")));
    await expect(
      tool.execute("1", { url: "https://example.com" }),
    ).resolves.toBeDefined();
    expect(acc).toEqual([]);
  });

  it("shares state across multiple wrapped tools", async () => {
    const acc: unknown[] = [];
    const interceptBrowserFn = vi
      .fn()
      .mockResolvedValueOnce("[]")
      .mockResolvedValueOnce(JSON.stringify([{ event: "page_view" }]))
      .mockResolvedValueOnce("[]")
      .mockResolvedValueOnce(
        JSON.stringify([{ event: "click" }]),
      ) as unknown as BrowserFn;
    const intercept = createDataLayerInterceptor(
      acc,
      interceptBrowserFn,
      noSettle,
    );
    const navigate = intercept(createNavigateTool(mockBrowser("ok")));
    const click = intercept(createClickTool(mockBrowser("ok")));
    await navigate.execute("1", { url: "https://example.com" });
    await click.execute("1", { selector: "@e1" });
    expect(acc).toEqual([{ event: "page_view" }, { event: "click" }]);
  });

  it("captures delayed click events during the settle window", async () => {
    const acc: unknown[] = [];
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const interceptBrowserFn = vi
      .fn()
      .mockResolvedValueOnce("[]")
      .mockResolvedValueOnce("[]")
      .mockResolvedValueOnce("[]")
      .mockResolvedValueOnce("[]")
      .mockResolvedValueOnce(JSON.stringify([{ event: "delayed_click" }]))
      .mockResolvedValueOnce("[]") as unknown as BrowserFn;
    const intercept = createDataLayerInterceptor(acc, interceptBrowserFn, {
      settleMs: 250,
      settleIntervalMs: 50,
      sleepFn,
    });
    const tool = intercept(createClickTool(mockBrowser("ok")));

    await tool.execute("1", { selector: "@e1" });

    expect(sleepFn).toHaveBeenCalledTimes(5);
    expect(sleepFn).toHaveBeenCalledWith(50);
    expect(acc).toEqual([{ event: "delayed_click" }]);
  });

  it("does not double-count an event returned by both capturedEvents and drainInterceptor", async () => {
    // Regression: the click tool's push override previously always wrote to sessionStorage,
    // even when drainInterceptor's bridge was also active. This caused the same event to
    // appear in both capturedEvents (from the tool result) and the post-tool drain, making
    // recoveredCount=2 for a single event and warning "2 dataLayer event(s)" with one name.
    const acc: unknown[] = [];
    const addToCart = { event: "add_to_cart" };

    // Simulate: pre-drain returns nothing, post-drain returns the same event that the
    // tool already captured in capturedEvents (the double-write scenario).
    const interceptBrowserFn = vi
      .fn()
      .mockResolvedValueOnce("[]") // pre-drain
      .mockResolvedValueOnce(
        JSON.stringify({ events: [addToCart], recoveredCount: 1 }),
      ) // post-drain returns same event
      .mockResolvedValueOnce("[]") as unknown as BrowserFn; // settle

    const intercept = createDataLayerInterceptor(acc, interceptBrowserFn, {
      settleMs: 0,
    });

    // Build a tool that returns the event in capturedEvents (as the find/click tool does)
    const toolWithCapturedEvents = intercept({
      name: "browser_find",
      description: "",
      label: "",
      parameters: {} as never,
      execute: async () => ({
        content: [{ type: "text" as const, text: "✓ Done" }],
        details: { capturedEvents: [addToCart], timingRiskWarning: true },
      }),
    });

    await toolWithCapturedEvents.execute("1", {});

    expect(acc).toEqual([addToCart]);
    expect(acc).toHaveLength(1);
  });

  it("waits during settle window when browser_find executes with action:click", async () => {
    const acc: unknown[] = [];
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const interceptBrowserFn = vi
      .fn()
      .mockResolvedValue("[]") as unknown as BrowserFn;
    const intercept = createDataLayerInterceptor(acc, interceptBrowserFn, {
      settleMs: 100,
      settleIntervalMs: 100,
      sleepFn,
    });
    const tool = intercept(createFindTool(mockBrowser("ok")));

    await tool.execute("1", { action: "click", testId: "btn" });

    expect(sleepFn).toHaveBeenCalledTimes(1);
  });

  it("skips settle window when browser_find executes with a non-click action", async () => {
    const acc: unknown[] = [];
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const interceptBrowserFn = vi
      .fn()
      .mockResolvedValue("[]") as unknown as BrowserFn;
    const intercept = createDataLayerInterceptor(acc, interceptBrowserFn, {
      settleMs: 100,
      settleIntervalMs: 100,
      sleepFn,
    });
    const tool = intercept(createFindTool(mockBrowser("ok")));

    await tool.execute("1", { action: "hover", testId: "btn" });

    expect(sleepFn).not.toHaveBeenCalled();
  });

  it("skips settle window when browser_find receives non-object args", async () => {
    const acc: unknown[] = [];
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const interceptBrowserFn = vi
      .fn()
      .mockResolvedValue("[]") as unknown as BrowserFn;
    const intercept = createDataLayerInterceptor(acc, interceptBrowserFn, {
      settleMs: 100,
      settleIntervalMs: 100,
      sleepFn,
    });
    const tool = intercept({
      name: "browser_find",
      description: "",
      label: "",
      parameters: {} as never,
      execute: async () => ({ content: [{ type: "text" as const, text: "ok" }], details: {} }),
    });

    await tool.execute("1", null);

    expect(sleepFn).not.toHaveBeenCalled();
  });

  it("skips settle window for tools other than browser_click and browser_find", async () => {
    const acc: unknown[] = [];
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const interceptBrowserFn = vi
      .fn()
      .mockResolvedValue("[]") as unknown as BrowserFn;
    const intercept = createDataLayerInterceptor(acc, interceptBrowserFn, {
      settleMs: 100,
      settleIntervalMs: 100,
      sleepFn,
    });
    const tool = intercept(createNavigateTool(mockBrowser("ok")));

    await tool.execute("1", { url: "https://example.com" });

    expect(sleepFn).not.toHaveBeenCalled();
  });
});

// ─── createDataLayerPoller ────────────────────────────────────────────────────

describe("createDataLayerPoller", () => {
  it("appends new dataLayer events to accumulator after the wrapped tool executes", async () => {
    const acc: unknown[] = [];
    const pollBrowserFn = mockBrowser(JSON.stringify([{ event: "page_view" }]));
    const poll = createDataLayerPoller(acc, pollBrowserFn);
    const tool = poll(createNavigateTool(mockBrowser("ok")));
    await tool.execute("1", { url: "https://example.com" });
    expect(acc).toEqual([{ event: "page_view" }]);
  });

  it("advances the dataLayer index so subsequent calls do not double-count", async () => {
    const acc: unknown[] = [];
    const pollBrowserFn = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify([{ event: "page_view" }]))
      .mockResolvedValueOnce(
        JSON.stringify([{ event: "add_to_cart" }]),
      ) as unknown as BrowserFn;
    const poll = createDataLayerPoller(acc, pollBrowserFn);
    const tool = poll(createNavigateTool(mockBrowser("ok")));
    await tool.execute("1", { url: "https://a.com" });
    await tool.execute("1", { url: "https://b.com" });
    expect(acc).toEqual([{ event: "page_view" }, { event: "add_to_cart" }]);
    // Second poll must use slice(1), not slice(0)
    expect(vi.mocked(pollBrowserFn).mock.calls[1][0]).toEqual([
      "eval",
      "JSON.stringify((window.dataLayer || []).slice(1))",
    ]);
  });

  it("returns the original tool result unchanged", async () => {
    const acc: unknown[] = [];
    const poll = createDataLayerPoller(acc, mockBrowser("[]"));
    const tool = poll(createNavigateTool(mockBrowser("Navigation complete")));
    const result = await tool.execute("1", { url: "https://example.com" });
    expect((result.content[0] as { text: string }).text).toBe(
      "Navigation complete",
    );
  });

  it("does not throw when dataLayer capture fails", async () => {
    const acc: unknown[] = [];
    const failingBrowserFn = vi
      .fn()
      .mockRejectedValue(new Error("timeout")) as unknown as BrowserFn;
    const poll = createDataLayerPoller(acc, failingBrowserFn);
    const tool = poll(createNavigateTool(mockBrowser("ok")));
    await expect(
      tool.execute("1", { url: "https://example.com" }),
    ).resolves.toBeDefined();
    expect(acc).toEqual([]);
  });

  it("shares the index across multiple wrapped tools", async () => {
    const acc: unknown[] = [];
    const pollBrowserFn = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify([{ event: "page_view" }]))
      .mockResolvedValueOnce(
        JSON.stringify([{ event: "click" }]),
      ) as unknown as BrowserFn;
    const poll = createDataLayerPoller(acc, pollBrowserFn);
    const navigate = poll(createNavigateTool(mockBrowser("ok")));
    const click = poll(createClickTool(mockBrowser("ok")));
    await navigate.execute("1", { url: "https://example.com" });
    await click.execute("1", { selector: "@e1" });
    // Second poll should use slice(1)
    expect(vi.mocked(pollBrowserFn).mock.calls[1][0]).toEqual([
      "eval",
      "JSON.stringify((window.dataLayer || []).slice(1))",
    ]);
    expect(acc).toEqual([{ event: "page_view" }, { event: "click" }]);
  });
});
