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
    expect((result.content[0] as { text: string }).text).toBe(
      "- button @e1\n- link @e2",
    );
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
    expect((result.content[0] as { text: string }).text).toBe("Clicked");
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
    expect((result.content[0] as { text: string }).text).toBe("[]");
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
});

// ─── createFindTool ───────────────────────────────────────────────────────────
describe("createFindTool", () => {
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
    expect((result.content[0] as { text: string }).text.toLowerCase()).toMatch(
      /continue|done|completed/,
    );
  });

  it("is included in allTools", () => {
    const names = allTools.map((t) => t.name);
    expect(names).toContain("request_human_input");
  });
});

// ─── createDataLayerInterceptor ───────────────────────────────────────────────

describe("createDataLayerInterceptor", () => {
  it("appends drained events to accumulator after the wrapped tool executes", async () => {
    const acc: unknown[] = [];
    const events = [{ event: "page_view" }];
    const interceptBrowserFn = mockBrowser(JSON.stringify(events));
    const intercept = createDataLayerInterceptor(acc, interceptBrowserFn);
    const tool = intercept(createNavigateTool(mockBrowser("ok")));
    await tool.execute("1", { url: "https://example.com" });
    expect(acc).toEqual(events);
  });

  it("accumulates across multiple calls without double-counting", async () => {
    const acc: unknown[] = [];
    const interceptBrowserFn = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify([{ event: "page_view" }]))
      .mockResolvedValueOnce(
        JSON.stringify([{ event: "add_to_cart" }]),
      ) as unknown as BrowserFn;
    const intercept = createDataLayerInterceptor(acc, interceptBrowserFn);
    const tool = intercept(createNavigateTool(mockBrowser("ok")));
    await tool.execute("1", { url: "https://a.com" });
    await tool.execute("1", { url: "https://b.com" });
    expect(acc).toEqual([{ event: "page_view" }, { event: "add_to_cart" }]);
  });

  it("returns the original tool result unchanged", async () => {
    const acc: unknown[] = [];
    const intercept = createDataLayerInterceptor(acc, mockBrowser("[]"));
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
    const intercept = createDataLayerInterceptor(acc, failingBrowserFn);
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
      .mockResolvedValueOnce(JSON.stringify([{ event: "page_view" }]))
      .mockResolvedValueOnce(
        JSON.stringify([{ event: "click" }]),
      ) as unknown as BrowserFn;
    const intercept = createDataLayerInterceptor(acc, interceptBrowserFn);
    const navigate = intercept(createNavigateTool(mockBrowser("ok")));
    const click = intercept(createClickTool(mockBrowser("ok")));
    await navigate.execute("1", { url: "https://example.com" });
    await click.execute("1", { selector: "@e1" });
    expect(acc).toEqual([{ event: "page_view" }, { event: "click" }]);
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
