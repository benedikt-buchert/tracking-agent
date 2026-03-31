import type { SignalBackedCase } from "./types.js";
import {
  createStandaloneStagehandAgent,
  resolvePreferredStagehandHybridAgentOptions,
  type StandaloneStagehandAgent,
} from "../browser/stagehand.js";

type StagehandRunResult = {
  accumulatedEvents: unknown[];
  actionStepsTotal: number;
  toolCallsTotal: number;
  noProgressActionStreakMax?: number;
  journeyCompleted?: boolean;
  humanInterventionNeeded?: boolean;
  captureDiagnostics?: {
    capturedEvents: unknown[];
    rawDataLayerEvents: unknown[];
  };
};

type CreateAgent = (
  url: string,
  options: { headless: boolean; agentOptions?: unknown },
) => Promise<StandaloneStagehandAgent>;

type InterventionDecision = "continue" | "stop";

type InterventionContext = {
  accumulatedEvents: unknown[];
};

type StagehandVariables = Record<
  string,
  { value: string; description: string }
>;

interface RunStagehandCaseOptions {
  headless: boolean;
  createAgent?: CreateAgent;
  cacheDir?: string;
  phaseTimeoutMs?: number;
  variables?: StagehandVariables;
  onInterventionNeeded?: (
    context: InterventionContext,
  ) => Promise<InterventionDecision>;
}

type AgentExecuteResult = {
  completed?: boolean;
  actions?: unknown[];
};

const PHASE_SETTLE_MS = 1200;
const DEFAULT_PHASE_TIMEOUT_MS = 180_000;
const FINALIZE_TIMEOUT_MS = 5_000;

type PhaseResult =
  | {
      status: "completed";
      result: unknown;
      drainedEvents: unknown[];
    }
  | {
      status: "timed_out";
      drainedEvents: unknown[];
    };

function mergeUniqueEvents(a: unknown[], b: unknown[]): unknown[] {
  const seen = new Set<string>();
  const merged: unknown[] = [];
  for (const event of [...a, ...b]) {
    const key = JSON.stringify(event);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(event);
    }
  }
  return merged;
}

function observedEventNames(events: unknown[]): Set<string> {
  const names = new Set<string>();
  for (const event of events) {
    if (event && typeof event === "object") {
      const name = (event as Record<string, unknown>)["event"];
      if (typeof name === "string") names.add(name);
    }
  }
  return names;
}

function hasImportantEvent(
  testCase: SignalBackedCase,
  events: unknown[],
): boolean {
  const importantEvents =
    testCase.expected_signals.important_event_names_any_of ?? [];
  if (importantEvents.length === 0) return false;
  const names = observedEventNames(events);
  return importantEvents.some((name) => names.has(name));
}

function buildInstruction(testCase: SignalBackedCase): string {
  const important = (
    testCase.expected_signals.important_event_names_any_of ?? []
  ).join(", ");
  return (
    `Starting from the current page, complete this journey: ${testCase.journey_hint}. ` +
    `Trigger the most important analytics events when practical: ${important || "the key site interaction"}.`
  );
}

async function drainEvents(
  agent: StandaloneStagehandAgent,
): Promise<unknown[]> {
  return await agent.drainCapturedEvents();
}

function extractActionCount(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const actions = (result as AgentExecuteResult).actions;
  return Array.isArray(actions) ? actions.length : 0;
}

function extractCompleted(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  return (result as AgentExecuteResult).completed === true;
}

async function bestEffortDrainEvents(
  agent: StandaloneStagehandAgent,
): Promise<unknown[]> {
  try {
    return await drainEvents(agent);
  } catch {
    return [];
  }
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(new Error(`Stagehand timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runAgentPhase(
  agent: StandaloneStagehandAgent,
  instruction: string,
  maxSteps: number,
  timeoutMs: number,
  variables?: StagehandVariables,
): Promise<PhaseResult> {
  const controller = new AbortController();
  const operation = (async () => {
    const result = await agent.execute({
      instruction,
      maxSteps,
      variables,
      signal: controller.signal,
    });
    await agent.waitForTimeout(PHASE_SETTLE_MS);
    return result;
  })();
  try {
    const result = await withTimeout(operation, timeoutMs, () =>
      controller.abort("Stagehand timeout"),
    );
    return {
      status: "completed",
      result,
      drainedEvents: await bestEffortDrainEvents(agent),
    };
  } catch {
    return {
      status: "timed_out",
      drainedEvents: await bestEffortDrainEvents(agent),
    };
  }
}

export async function runStagehandCase(
  testCase: SignalBackedCase,
  options: RunStagehandCaseOptions,
): Promise<StagehandRunResult> {
  const defaultAgentOptions = options.createAgent
    ? undefined
    : resolvePreferredStagehandHybridAgentOptions();
  const createAgent =
    options.createAgent ??
    ((url, agentOptions) =>
      createStandaloneStagehandAgent(url, {
        headless: agentOptions.headless,
        agentOptions: agentOptions.agentOptions,
        cacheDir: options.cacheDir,
      }));

  const agent = await createAgent(testCase.entry_url, {
    headless: options.headless,
    agentOptions: defaultAgentOptions,
  });
  const maxSteps = Math.min(testCase.budgets.max_action_steps, 20);
  const phaseTimeoutMs = options.phaseTimeoutMs ?? DEFAULT_PHASE_TIMEOUT_MS;

  let allEvents = await drainEvents(agent);
  let actionStepsTotal = 0;
  let toolCallsTotal = 1;
  let journeyCompleted = false;
  let humanInterventionNeeded = false;

  const finalize = async (
    result: Omit<StagehandRunResult, "captureDiagnostics">,
  ): Promise<StagehandRunResult> => {
    try {
      return {
        ...result,
        captureDiagnostics: await withTimeout(
          agent.getCaptureDiagnostics(),
          FINALIZE_TIMEOUT_MS,
        ),
      };
    } catch {
      return result;
    }
  };

  try {
    const phase = await runAgentPhase(
      agent,
      buildInstruction(testCase),
      maxSteps,
      phaseTimeoutMs,
      options.variables,
    );
    allEvents = mergeUniqueEvents(allEvents, phase.drainedEvents);
    toolCallsTotal += 1;

    if (phase.status === "completed") {
      actionStepsTotal += extractActionCount(phase.result);
      journeyCompleted = extractCompleted(phase.result);
    } else if (options.onInterventionNeeded) {
      const decision = await options.onInterventionNeeded({
        accumulatedEvents: allEvents,
      });
      if (decision === "continue") {
        allEvents = mergeUniqueEvents(
          allEvents,
          await bestEffortDrainEvents(agent),
        );
      }
      humanInterventionNeeded = decision === "stop";
    } else {
      humanInterventionNeeded = true;
    }

    const importantFound = hasImportantEvent(testCase, allEvents);
    return finalize({
      accumulatedEvents: allEvents,
      actionStepsTotal,
      toolCallsTotal,
      noProgressActionStreakMax: 0,
      journeyCompleted: journeyCompleted || importantFound,
      humanInterventionNeeded,
    });
  } finally {
    await agent.close();
  }
}
