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
  phase: "phase1" | "repair" | "phase2" | "phase3";
  accumulatedEvents: unknown[];
};

type StagehandVariables = Record<
  string,
  { value: string; description: string }
>;

interface RunStagehandCaseOptions {
  headless: boolean;
  createAgent?: CreateAgent;
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

type RunnerState = {
  allEvents: unknown[];
  actionStepsTotal: number;
  toolCallsTotal: number;
  journeyCompleted: boolean;
  humanInterventionNeeded: boolean;
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

function isPurchaseJourney(testCase: SignalBackedCase): boolean {
  const importantEvents = (
    testCase.expected_signals.important_event_names_any_of ?? []
  ).join(", ");
  return (
    importantEvents.includes("purchase") ||
    /purchase|checkout|cart|order|payment/i.test(testCase.journey_hint)
  );
}

function baseConstraintSuffix(testCase: SignalBackedCase): string {
  if (!isPurchaseJourney(testCase)) return "";
  return " Prefer guest or anonymous checkout. Only create an account if the site clearly requires it. Prefer in-site card payment over external redirects when practical.";
}

function buildPhaseOneInstruction(testCase: SignalBackedCase): string {
  const important = (
    testCase.expected_signals.important_event_names_any_of ?? []
  ).join(", ");
  if (isPurchaseJourney(testCase)) {
    return (
      "On this website, buy a single in-stock product using guest checkout. " +
      "Prefer in-site credit card over external redirects, keep account creation off unless required, " +
      "and continue until you reach the delivery address step, payment step, final order confirmation, or payment handoff." +
      baseConstraintSuffix(testCase)
    );
  }
  return (
    `Starting from the current page, complete this journey: ${testCase.journey_hint}. ` +
    `Trigger the most important analytics events when practical: ${important || "the key site interaction"}.`
  );
}

function buildPhaseTwoInstruction(testCase: SignalBackedCase): string {
  return (
    "You are resuming the checkout in the existing browser session after deterministic form correction. " +
    "Do not rewrite the delivery fields unless they are still visibly empty or invalid. " +
    "If an address suggestion prompt appears, click 'ACCEPT ADDRESS'. " +
    "Keep account creation off unless the site forces it, keep billing address the same as shipping when possible, " +
    "prefer in-site credit card over external redirects, and continue until final confirmation or payment handoff." +
    baseConstraintSuffix(testCase)
  );
}

function buildPhaseThreeInstruction(testCase: SignalBackedCase): string {
  return (
    "You are on the credit-card payment flow. If the Klarna credit-card widget is loaded, complete the purchase with " +
    "card number 4111 1111 1111 1111, expiry 12/28, and CVC 123. " +
    "If a 3D Secure card is needed, use 4687 3888 8888 8881 instead. " +
    "Continue until the final order confirmation page or a confirmed purchase completion state appears." +
    baseConstraintSuffix(testCase)
  );
}

function buildCheckoutRepairScript(email: string): string {
  return `(() => {
  const normalize = (value) =>
    String(value ?? "")
      .replace(/\\s+/g, " ")
      .trim()
      .toLowerCase();

  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      rect.width > 0 &&
      rect.height > 0
    );
  };

  const controlLabel = (element) => {
    if (!(element instanceof HTMLElement)) return "";
    const labels = [];
    if ("labels" in element && element.labels) {
      labels.push(...Array.from(element.labels).map((label) => label.textContent ?? ""));
    }
    const id = element.getAttribute("id");
    if (id) {
      labels.push(
        ...Array.from(document.querySelectorAll('label[for="' + id + '"]')).map(
          (label) => label.textContent ?? "",
        ),
      );
    }
    const closestLabel = element.closest("label");
    if (closestLabel) labels.push(closestLabel.textContent ?? "");
    labels.push(
      element.getAttribute("aria-label") ?? "",
      element.getAttribute("placeholder") ?? "",
      element.getAttribute("name") ?? "",
      element.getAttribute("id") ?? "",
      element.getAttribute("autocomplete") ?? "",
    );
    return normalize(labels.join(" "));
  };

  const clickVisibleText = (pattern) => {
    const candidates = Array.from(
      document.querySelectorAll("button, a, label, [role='button'], [role='tab'], input[type='submit'], input[type='button']"),
    ).filter((element) => isVisible(element));
    for (const candidate of candidates) {
      const text = normalize(candidate.textContent || candidate.getAttribute("value") || candidate.getAttribute("aria-label"));
      if (!text || !pattern.test(text)) continue;
      candidate.click();
      return true;
    }
    return false;
  };

  const setCheckbox = (pattern, desired) => {
    const candidates = Array.from(document.querySelectorAll("input[type='checkbox']"));
    for (const candidate of candidates) {
      const text = controlLabel(candidate);
      if (!pattern.test(text)) continue;
      const hasVisibleLabel =
        Array.from(candidate.labels ?? []).some((label) => isVisible(label)) ||
        (candidate.id
          ? Array.from(document.querySelectorAll('label[for="' + candidate.id + '"]')).some((label) => isVisible(label))
          : false);
      if (!isVisible(candidate) && !hasVisibleLabel) continue;
      if (candidate.checked !== desired) {
        const label = candidate.labels?.[0] ??
          (candidate.id ? document.querySelector('label[for="' + candidate.id + '"]') : null);
        if (label instanceof HTMLElement) label.click();
        else candidate.click();
      }
      return true;
    }
    return false;
  };

  const editableFields = Array.from(document.querySelectorAll("input, textarea")).filter((element) => {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false;
    if (!isVisible(element)) return false;
    if (element instanceof HTMLInputElement) {
      return !["hidden", "checkbox", "radio", "submit", "button"].includes(element.type || "text");
    }
    return true;
  });

  const setField = (pattern, value) => {
    for (const field of editableFields) {
      const label = controlLabel(field);
      if (!pattern.test(label)) continue;
      field.focus();
      field.value = "";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      field.blur();
      return true;
    }
    return false;
  };

  clickVisibleText(/to my home or to the office|home or office/);
  setCheckbox(/create.*customer account|create.*account|customer account/, false);
  setCheckbox(/billing address|same as shipping|also your billing address/, true);
  setField(/e-?mail/, ${JSON.stringify(email)});
  setField(/first name|vorname/, "Max");
  setField(/last name|surname|nachname/, "Mustermann");
  setField(/street(?!.*number)|strasse|straße/, "Kaufingerstrasse");
  setField(/house.*(no|number)|street.*number|hausnummer/, "28");
  setField(/postal|zip|post code|postcode|plz/, "80331");
  setField(/city|town|ort/, "Muenchen");
  setField(/phone|telephone|tel/, "0895517970");
  clickVisibleText(/accept address/);
  clickVisibleText(/continue to payment and shipping|continue to payment|payment and shipping|continue/i);
  return { repaired: true, url: window.location.href };
})()`;
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

async function repairCheckoutForm(
  agent: StandaloneStagehandAgent,
): Promise<void> {
  const guestEmail = `stagehand.checkout.${Date.now()}@example.com`;
  await agent.evaluate(buildCheckoutRepairScript(guestEmail));
  await agent.waitForTimeout(PHASE_SETTLE_MS);
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
          reject(new Error(`Stagehand phase timed out after ${timeoutMs}ms`));
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
    const phaseResult = await agent.execute({
      instruction,
      maxSteps,
      variables,
      signal: controller.signal,
    });
    await agent.waitForTimeout(PHASE_SETTLE_MS);
    return phaseResult;
  })();
  try {
    const result = await withTimeout(operation, timeoutMs, () =>
      controller.abort("Stagehand phase timeout"),
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

async function tryRepairCheckoutForm(
  agent: StandaloneStagehandAgent,
  timeoutMs: number,
): Promise<boolean> {
  try {
    await withTimeout(repairCheckoutForm(agent), timeoutMs);
    return true;
  } catch {
    return false;
  }
}

async function handleIntervention(
  agent: StandaloneStagehandAgent,
  options: RunStagehandCaseOptions,
  phase: InterventionContext["phase"],
  accumulatedEvents: unknown[],
): Promise<{ decision: InterventionDecision; drainedEvents: unknown[] }> {
  if (!options.onInterventionNeeded) {
    return { decision: "stop", drainedEvents: [] };
  }

  const decision = await options.onInterventionNeeded({
    phase,
    accumulatedEvents,
  });
  return {
    decision,
    drainedEvents:
      decision === "continue" ? await bestEffortDrainEvents(agent) : [],
  };
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
      }));

  const agent = await createAgent(testCase.entry_url, {
    headless: options.headless,
    agentOptions: defaultAgentOptions,
  });
  const maxSteps = Math.min(testCase.budgets.max_action_steps, 20);
  const phaseTimeoutMs = options.phaseTimeoutMs ?? DEFAULT_PHASE_TIMEOUT_MS;
  const isPurchase = isPurchaseJourney(testCase);
  const state: RunnerState = {
    allEvents: await drainEvents(agent),
    actionStepsTotal: 0,
    toolCallsTotal: 1,
    journeyCompleted: false,
    humanInterventionNeeded: false,
  };
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
  const mergeEvents = (events: unknown[]) => {
    state.allEvents = mergeUniqueEvents(state.allEvents, events);
  };
  const updateFromCompletedPhase = (result: unknown) => {
    state.actionStepsTotal += extractActionCount(result);
    state.toolCallsTotal += 1;
    state.journeyCompleted ||= extractCompleted(result);
  };
  const snapshot = (
    overrides: Partial<
      Pick<StagehandRunResult, "journeyCompleted" | "humanInterventionNeeded">
    > = {},
  ): Omit<StagehandRunResult, "captureDiagnostics"> => ({
    accumulatedEvents: state.allEvents,
    actionStepsTotal: state.actionStepsTotal,
    toolCallsTotal: state.toolCallsTotal,
    noProgressActionStreakMax: 0,
    journeyCompleted: state.journeyCompleted,
    humanInterventionNeeded: state.humanInterventionNeeded,
    ...overrides,
  });
  const importantEventObserved = () =>
    hasImportantEvent(testCase, state.allEvents);

  try {
    const phase1 = await runAgentPhase(
      agent,
      buildPhaseOneInstruction(testCase),
      maxSteps,
      phaseTimeoutMs,
      options.variables,
    );
    state.toolCallsTotal += 1;
    mergeEvents(phase1.drainedEvents);
    if (phase1.status === "timed_out") {
      const intervention = await handleIntervention(
        agent,
        options,
        "phase1",
        state.allEvents,
      );
      mergeEvents(intervention.drainedEvents);
      if (
        intervention.decision === "stop" ||
        !isPurchase ||
        importantEventObserved()
      ) {
        return finalize(
          snapshot({
            journeyCompleted: importantEventObserved(),
            humanInterventionNeeded: intervention.decision === "stop",
          }),
        );
      }
    } else {
      updateFromCompletedPhase(phase1.result);
    }
    if (importantEventObserved()) {
      return finalize(snapshot({ journeyCompleted: true }));
    }

    if (!isPurchase) {
      return finalize(snapshot());
    }

    if (!(await tryRepairCheckoutForm(agent, phaseTimeoutMs))) {
      const intervention = await handleIntervention(
        agent,
        options,
        "repair",
        state.allEvents,
      );
      mergeEvents(intervention.drainedEvents);
      if (intervention.decision === "stop" || importantEventObserved()) {
        return finalize(
          snapshot({
            journeyCompleted: importantEventObserved(),
            humanInterventionNeeded: intervention.decision === "stop",
          }),
        );
      }
    }
    state.toolCallsTotal += 1;

    const phase2 = await runAgentPhase(
      agent,
      buildPhaseTwoInstruction(testCase),
      maxSteps,
      phaseTimeoutMs,
      options.variables,
    );
    state.toolCallsTotal += 1;
    mergeEvents(phase2.drainedEvents);
    if (phase2.status === "timed_out") {
      const intervention = await handleIntervention(
        agent,
        options,
        "phase2",
        state.allEvents,
      );
      mergeEvents(intervention.drainedEvents);
      if (intervention.decision === "stop" || importantEventObserved()) {
        return finalize(
          snapshot({
            journeyCompleted: importantEventObserved(),
            humanInterventionNeeded: intervention.decision === "stop",
          }),
        );
      }
    } else {
      updateFromCompletedPhase(phase2.result);
    }
    if (importantEventObserved()) {
      return finalize(snapshot({ journeyCompleted: true }));
    }

    const phase3 = await runAgentPhase(
      agent,
      buildPhaseThreeInstruction(testCase),
      maxSteps,
      phaseTimeoutMs,
      options.variables,
    );
    state.toolCallsTotal += 1;
    mergeEvents(phase3.drainedEvents);
    if (phase3.status === "timed_out") {
      const intervention = await handleIntervention(
        agent,
        options,
        "phase3",
        state.allEvents,
      );
      mergeEvents(intervention.drainedEvents);
      state.humanInterventionNeeded = intervention.decision === "stop";
      return finalize(snapshot({ journeyCompleted: importantEventObserved() }));
    }
    updateFromCompletedPhase(phase3.result);

    return finalize(
      snapshot({
        journeyCompleted: state.journeyCompleted || importantEventObserved(),
      }),
    );
  } finally {
    await agent.close();
  }
}
