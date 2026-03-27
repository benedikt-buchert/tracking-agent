// Action tools (count as action steps)
const ACTION_TOOLS = new Set([
  "browser_navigate",
  "browser_click",
  "browser_fill",
]);

// browser_find counts as an action step only when action=click or action=fill
const BROWSER_FIND_ACTION_VALUES = new Set(["click", "fill"]);

// Observation/utility tools (do NOT count as action steps)
// browser_snapshot, browser_screenshot, browser_eval, browser_wait,
// get_datalayer, skip_task, request_human_input

export interface ToolCall {
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * Returns true if this tool call should count as one normalized action step.
 *
 * Action steps are meaningful external interactions:
 * - browser_navigate
 * - browser_click
 * - browser_fill
 * - browser_find with action=click or action=fill
 *
 * Observation tools, waits, data reads, and utility calls are NOT counted.
 */
export function isActionStep(toolName: string, args: Record<string, unknown>): boolean {
  if (ACTION_TOOLS.has(toolName)) return true;

  if (toolName === "browser_find") {
    const action = args["action"];
    return typeof action === "string" && BROWSER_FIND_ACTION_VALUES.has(action);
  }

  return false;
}

/**
 * Count the total number of action steps in a list of tool calls.
 */
export function countActionSteps(calls: ToolCall[]): number {
  let count = 0;
  for (const call of calls) {
    if (isActionStep(call.toolName, call.args)) count++;
  }
  return count;
}
