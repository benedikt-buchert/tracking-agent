import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock child_process so no real agent-browser calls happen ────────────────
vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

import * as childProcess from "child_process";
import {
  navigateTool,
  snapshotTool,
  clickTool,
  fillTool,
  evalTool,
  waitTool,
  getDataLayerTool,
  fetchSchemaTool,
  validateEventTool,
  findTool,
  allTools,
} from "./tools.js";

// Helper: make exec call its callback with stdout
function stubExec(stdout: string, stderr = "") {
  vi.mocked(childProcess.exec).mockImplementation((_cmd: any, _opts: any, cb: any) => {
    cb(null, stdout, stderr);
    return {} as any;
  });
}

function stubExecError(stderr: string) {
  vi.mocked(childProcess.exec).mockImplementation((_cmd: any, _opts: any, cb: any) => {
    const err = Object.assign(new Error(stderr), { stdout: "", stderr });
    cb(err, "", stderr);
    return {} as any;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── allTools ─────────────────────────────────────────────────────────────────
describe("allTools", () => {
  it("exports all tools in a single array", () => {
    expect(allTools).toHaveLength(11);
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
});

// ─── navigateTool ─────────────────────────────────────────────────────────────
describe("navigateTool", () => {
  it("calls agent-browser open with the given URL", async () => {
    stubExec("Navigated");
    const result = await navigateTool.execute("1", { url: "https://example.com" });
    const cmd = vi.mocked(childProcess.exec).mock.calls[0][0] as string;
    expect(cmd).toContain('open "https://example.com"');
    expect(cmd).toContain("networkidle");
    expect(result.content[0].type).toBe("text");
  });

  it("returns agent-browser output as text", async () => {
    stubExec("Navigation complete");
    const result = await navigateTool.execute("1", { url: "https://foo.com" });
    expect((result.content[0] as any).text).toBe("Navigation complete");
  });

  it("returns fallback message when stdout is empty", async () => {
    stubExec("");
    const result = await navigateTool.execute("1", { url: "https://foo.com" });
    expect((result.content[0] as any).text).toBe("Navigated successfully");
  });
});

// ─── snapshotTool ─────────────────────────────────────────────────────────────
describe("snapshotTool", () => {
  it("calls agent-browser snapshot without flag by default", async () => {
    stubExec("tree");
    await snapshotTool.execute("1", {});
    const cmd = vi.mocked(childProcess.exec).mock.calls[0][0] as string;
    expect(cmd).toContain("snapshot");
    expect(cmd).not.toContain("-i");
  });

  it("adds -i flag when interactive_only is true", async () => {
    stubExec("tree");
    await snapshotTool.execute("1", { interactive_only: true });
    const cmd = vi.mocked(childProcess.exec).mock.calls[0][0] as string;
    expect(cmd).toContain("snapshot -i");
  });

  it("returns snapshot output", async () => {
    stubExec("- button @e1\n- link @e2");
    const result = await snapshotTool.execute("1", {});
    expect((result.content[0] as any).text).toBe("- button @e1\n- link @e2");
  });
});

// ─── browser error handling ───────────────────────────────────────────────────
describe("browser error handling", () => {
  it("returns stderr message when agent-browser exits non-zero", async () => {
    stubExecError("element not found: @e99");
    const result = await clickTool.execute("1", { selector: "@e99" });
    expect((result.content[0] as any).text).toContain("element not found");
  });
});

// ─── clickTool ────────────────────────────────────────────────────────────────
describe("clickTool", () => {
  it("calls agent-browser click with the selector", async () => {
    stubExec("clicked");
    await clickTool.execute("1", { selector: "@e3" });
    const cmd = vi.mocked(childProcess.exec).mock.calls[0][0] as string;
    expect(cmd).toContain('click "@e3"');
  });

  it("returns fallback when output is empty", async () => {
    stubExec("");
    const result = await clickTool.execute("1", { selector: "@e3" });
    expect((result.content[0] as any).text).toBe("Clicked");
  });
});

// ─── fillTool ─────────────────────────────────────────────────────────────────
describe("fillTool", () => {
  it("calls agent-browser fill with selector and text", async () => {
    stubExec("filled");
    await fillTool.execute("1", { selector: "@e1", text: "hello" });
    const cmd = vi.mocked(childProcess.exec).mock.calls[0][0] as string;
    expect(cmd).toContain('fill "@e1" "hello"');
  });
});

// ─── evalTool ─────────────────────────────────────────────────────────────────
describe("evalTool", () => {
  it("calls agent-browser eval with the JS expression", async () => {
    stubExec("42");
    const result = await evalTool.execute("1", { js: "1 + 1" });
    const cmd = vi.mocked(childProcess.exec).mock.calls[0][0] as string;
    expect(cmd).toContain("eval");
    expect(cmd).toContain("1 + 1");
    expect((result.content[0] as any).text).toBe("42");
  });
});

// ─── waitTool ─────────────────────────────────────────────────────────────────
describe("waitTool", () => {
  it("calls agent-browser wait with the target", async () => {
    stubExec("done");
    await waitTool.execute("1", { target: "1000" });
    const cmd = vi.mocked(childProcess.exec).mock.calls[0][0] as string;
    expect(cmd).toContain("wait 1000");
  });
});

// ─── getDataLayerTool ─────────────────────────────────────────────────────────
describe("getDataLayerTool", () => {
  it("evaluates window.dataLayer in the browser", async () => {
    stubExec('[{"event":"pageView"}]');
    const result = await getDataLayerTool.execute("1", {});
    const cmd = vi.mocked(childProcess.exec).mock.calls[0][0] as string;
    expect(cmd).toContain("dataLayer");
    expect(cmd).toContain("slice(0)");
    expect((result.content[0] as any).text).toBe('[{"event":"pageView"}]');
  });

  it("slices from from_index when provided", async () => {
    stubExec('[{"event":"click"}]');
    await getDataLayerTool.execute("1", { from_index: 3 });
    const cmd = vi.mocked(childProcess.exec).mock.calls[0][0] as string;
    expect(cmd).toContain("slice(3)");
  });

  it("returns empty array string when browser returns nothing", async () => {
    stubExec("");
    const result = await getDataLayerTool.execute("1", {});
    expect((result.content[0] as any).text).toBe("[]");
  });
});

// ─── fetchSchemaTool ──────────────────────────────────────────────────────────
describe("fetchSchemaTool", () => {
  it("fetches a JSON schema and returns pretty-printed JSON", async () => {
    const schema = { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => schema,
    } as any);

    const result = await fetchSchemaTool.execute("1", {
      url: "https://example.com/schema.json",
    });

    expect(global.fetch).toHaveBeenCalledWith("https://example.com/schema.json");
    const text = (result.content[0] as any).text;
    expect(text).toContain('"$schema"');
    expect(text).toContain('"type"');
  });

  it("returns an error message on HTTP failure", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 } as any);

    const result = await fetchSchemaTool.execute("1", { url: "https://bad.com/x.json" });
    expect((result.content[0] as any).text).toContain("404");
  });

  it("returns an error message on network failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const result = await fetchSchemaTool.execute("1", { url: "https://bad.com/x.json" });
    expect((result.content[0] as any).text).toContain("Network error");
  });
});

// ─── validateEventTool ────────────────────────────────────────────────────────
describe("validateEventTool", () => {
  const SCHEMA_URL = "https://example.com/schema.json";

  it("posts event to the validator with $schema set in body", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, errors: [] }),
    } as any);

    const event = { event: "page_view", page: "/home" };
    await validateEventTool.execute("1", { event, schema_url: SCHEMA_URL });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/validate/remote"),
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.stringContaining(SCHEMA_URL),
      })
    );
  });

  it("returns valid result when event matches schema", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, errors: [] }),
    } as any);

    const result = await validateEventTool.execute("1", {
      event: { event: "page_view" },
      schema_url: SCHEMA_URL,
    });
    const text = (result.content[0] as any).text;
    expect(text).toContain('"valid": true');
  });

  it("returns errors when event does not match schema", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        valid: false,
        errors: [{ instancePath: "/event", message: "must be string" }],
      }),
    } as any);

    const result = await validateEventTool.execute("1", {
      event: { event: 123 },
      schema_url: SCHEMA_URL,
    });
    const text = (result.content[0] as any).text;
    expect(text).toContain('"valid": false');
    expect(text).toContain("must be string");
  });

  it("returns helpful error when validator server is unreachable", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await validateEventTool.execute("1", {
      event: { event: "page_view" },
      schema_url: SCHEMA_URL,
    });
    const text = (result.content[0] as any).text;
    expect(text).toContain("ECONNREFUSED");
    expect(text).toContain("tracking_validator");
  });
});

// ─── findTool ─────────────────────────────────────────────────────────────────
describe("findTool", () => {
  it("builds correct command for click by role", async () => {
    stubExec("clicked");
    await findTool.execute("1", { locator: "role", value: "button", action: "click" });
    const cmd = vi.mocked(childProcess.exec).mock.calls[0][0] as string;
    expect(cmd).toContain('find role "button" click');
  });

  it("builds correct command for fill by label", async () => {
    stubExec("filled");
    await findTool.execute("1", { locator: "label", value: "Email", action: "fill", fill_text: "test@example.com" });
    const cmd = vi.mocked(childProcess.exec).mock.calls[0][0] as string;
    expect(cmd).toContain('find label "Email" fill "test@example.com"');
  });
});
