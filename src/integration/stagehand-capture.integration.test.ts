import { describe, expect, it, vi } from "vitest";
import { createStandaloneStagehandAgent } from "../browser/stagehand.js";
import { runStagehandCase } from "../harness/stagehand-runner.js";
import type { SignalBackedCase } from "../harness/types.js";

const discoveryCase: SignalBackedCase = {
  $schema: "s",
  case_id: "integration-capture",
  site_id: "fixture",
  kind: "live",
  entry_url: "https://example.com",
  journey_hint: "Reach the important tracked interaction on the site.",
  expected_signals: {
    tracking_surfaces: ["dataLayer"],
    important_event_names_any_of: ["sign_up"],
  },
  budgets: { max_action_steps: 20 },
  grader: { type: "heuristic", strictness: "medium" },
};

describe("stagehand capture integration", () => {
  it("captures page-buffered dataLayer events through the Stagehand wrapper", async () => {
    const goto = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify([]))
      .mockResolvedValueOnce(JSON.stringify([{ event: "sign_up" }]));
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);
    const addInitScript = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn().mockResolvedValue({
      completed: true,
      actions: [{}, {}],
    });
    const page = { goto, evaluate, waitForTimeout, addInitScript };

    class StagehandMock {
      init = vi.fn().mockResolvedValue(undefined);
      act = vi.fn().mockResolvedValue("ok");
      observe = vi.fn().mockResolvedValue([]);
      agent = vi.fn().mockReturnValue({ execute });
      close = vi.fn().mockResolvedValue(undefined);
      context = {
        pages: () => [page],
        addInitScript,
      };
    }

    const createAgent = async (
      url: string,
      options: { headless: boolean; agentOptions?: unknown },
    ) =>
      createStandaloneStagehandAgent(
        url,
        options,
        {
          loadStagehand: async () => ({ Stagehand: StagehandMock }),
          env: { STAGEHAND_MODEL: "openai/gpt-4.1-mini" },
        },
      );

    const result = await runStagehandCase(discoveryCase, {
      headless: true,
      createAgent,
    });

    expect(result.accumulatedEvents).toEqual([{ event: "sign_up" }]);
    expect(result.journeyCompleted).toBe(true);
  });
});
