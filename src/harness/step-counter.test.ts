import { describe, it, expect } from "vitest";
import { isActionStep, countActionSteps } from "./step-counter.js";
import type { ToolCall } from "./step-counter.js";

describe("isActionStep", () => {
  it("counts browser_navigate as action step", () => {
    expect(isActionStep("browser_navigate", {})).toBe(true);
  });

  it("counts browser_click as action step", () => {
    expect(isActionStep("browser_click", {})).toBe(true);
  });

  it("counts browser_fill as action step", () => {
    expect(isActionStep("browser_fill", {})).toBe(true);
  });

  it("counts browser_find with action=click as action step", () => {
    expect(isActionStep("browser_find", { action: "click" })).toBe(true);
  });

  it("counts browser_find with action=fill as action step", () => {
    expect(isActionStep("browser_find", { action: "fill" })).toBe(true);
  });

  it("does NOT count browser_find with no action as action step", () => {
    expect(isActionStep("browser_find", {})).toBe(false);
  });

  it("does NOT count browser_find with action=find as action step", () => {
    expect(isActionStep("browser_find", { action: "find" })).toBe(false);
  });

  it("does NOT count browser_snapshot as action step", () => {
    expect(isActionStep("browser_snapshot", {})).toBe(false);
  });

  it("does NOT count browser_screenshot as action step", () => {
    expect(isActionStep("browser_screenshot", {})).toBe(false);
  });

  it("does NOT count browser_eval as action step", () => {
    expect(isActionStep("browser_eval", {})).toBe(false);
  });

  it("does NOT count browser_wait as action step", () => {
    expect(isActionStep("browser_wait", {})).toBe(false);
  });

  it("does NOT count get_datalayer as action step", () => {
    expect(isActionStep("get_datalayer", {})).toBe(false);
  });

  it("does NOT count skip_task as action step", () => {
    expect(isActionStep("skip_task", {})).toBe(false);
  });

  it("does NOT count request_human_input as action step", () => {
    expect(isActionStep("request_human_input", {})).toBe(false);
  });

  it("does NOT count unknown tools as action steps", () => {
    expect(isActionStep("some_unknown_tool", {})).toBe(false);
  });
});

describe("countActionSteps", () => {
  const calls: ToolCall[] = [
    { toolName: "browser_navigate", args: { url: "http://example.com" } },
    { toolName: "browser_snapshot", args: {} },
    { toolName: "browser_click", args: { ref: "@e1" } },
    { toolName: "browser_wait", args: {} },
    { toolName: "browser_find", args: { action: "fill", fill_text: "test" } },
    { toolName: "browser_find", args: { action: "click" } },
    { toolName: "get_datalayer", args: {} },
    { toolName: "browser_fill", args: {} },
    { toolName: "skip_task", args: {} },
  ];

  it("counts only action tools", () => {
    // navigate(1) + click(1) + find-fill(1) + find-click(1) + fill(1) = 5
    expect(countActionSteps(calls)).toBe(5);
  });

  it("returns 0 for empty list", () => {
    expect(countActionSteps([])).toBe(0);
  });

  it("returns 0 for all observation tools", () => {
    const obs: ToolCall[] = [
      { toolName: "browser_snapshot", args: {} },
      { toolName: "browser_wait", args: {} },
      { toolName: "get_datalayer", args: {} },
      { toolName: "browser_eval", args: {} },
    ];
    expect(countActionSteps(obs)).toBe(0);
  });

  it("counts all action steps correctly", () => {
    const all: ToolCall[] = [
      { toolName: "browser_navigate", args: {} },
      { toolName: "browser_click", args: {} },
      { toolName: "browser_fill", args: {} },
    ];
    expect(countActionSteps(all)).toBe(3);
  });
});
