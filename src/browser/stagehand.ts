import { readFile } from "fs/promises";

export function isStagehandExperimentalBackendEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env["EXPERIMENTAL_BROWSER_BACKEND"] === "stagehand";
}

type StagehandModelConfig =
  | string
  | {
      modelName: string;
      project: string;
      location: string;
      googleAuthOptions: {
        credentials:
          | {
              client_email: string;
              private_key: string;
            }
          | {
              client_id: string;
              client_secret: string;
              refresh_token: string;
              type?: string;
            };
      };
    };

type ResolvedStagehandModel = {
  experimental: boolean;
  model: StagehandModelConfig;
};

export function resolveStagehandModel(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = env["STAGEHAND_MODEL"];
  if (explicit) return explicit;
  throw new Error("Stagehand experiment requires STAGEHAND_MODEL.");
}

async function resolveStagehandModelConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedStagehandModel> {
  if ((env["STAGEHAND_MODEL"] ?? "").startsWith("vertex/")) {
    return {
      experimental: true,
      model: await resolveVertexModelConfig(env),
    };
  }

  return { experimental: false, model: resolveStagehandModel(env) };
}

async function resolveVertexModelConfig(
  env: NodeJS.ProcessEnv,
): Promise<Exclude<StagehandModelConfig, string>> {
  const modelName = env["STAGEHAND_MODEL"] ?? "vertex/gemini-2.5-pro";
  const project = env["STAGEHAND_PROJECT"];
  const location = env["STAGEHAND_LOCATION"] ?? "us-central1";
  const credentials = await resolveVertexCredentials(env);

  if (!project) {
    throw new Error("Stagehand Vertex experiment requires STAGEHAND_PROJECT.");
  }

  return {
    modelName,
    project,
    location,
    googleAuthOptions: { credentials },
  };
}

async function resolveVertexCredentials(env: NodeJS.ProcessEnv): Promise<
  | { client_email: string; private_key: string }
  | {
      client_id: string;
      client_secret: string;
      refresh_token: string;
      type?: string;
    }
> {
  const clientEmail = env["GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL"];
  const privateKey = env["GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"];
  if (clientEmail && privateKey) {
    return {
      client_email: clientEmail,
      private_key: privateKey.replace(/\\n/g, "\n"),
    };
  }

  const credentialsPath = env["GOOGLE_APPLICATION_CREDENTIALS"];
  if (credentialsPath) {
    return loadGoogleCredentialsFile(credentialsPath);
  }

  const adcPath = `${process.env["HOME"] ?? ""}/.config/gcloud/application_default_credentials.json`;
  try {
    return await loadGoogleCredentialsFile(adcPath);
  } catch {
    // fall through to explicit error
  }

  throw new Error(
    "Stagehand Vertex experiment requires GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, a GOOGLE_APPLICATION_CREDENTIALS file, or local gcloud ADC credentials.",
  );
}

async function loadGoogleCredentialsFile(path: string): Promise<
  | { client_email: string; private_key: string }
  | {
      client_id: string;
      client_secret: string;
      refresh_token: string;
      type?: string;
    }
> {
  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw) as {
    client_email?: string;
    private_key?: string;
    client_id?: string;
    client_secret?: string;
    refresh_token?: string;
    type?: string;
  };
  if (parsed.client_email && parsed.private_key) {
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
    };
  }
  if (parsed.client_id && parsed.client_secret && parsed.refresh_token) {
    return {
      client_id: parsed.client_id,
      client_secret: parsed.client_secret,
      refresh_token: parsed.refresh_token,
      type: parsed.type,
    };
  }
  throw new Error(`Unsupported Google credentials file at ${path}.`);
}

type StagehandInstance = {
  init: () => Promise<void>;
  act: (instruction: string, options: { page: unknown }) => Promise<unknown>;
  observe: (
    instruction: string,
    options: { page: unknown },
  ) => Promise<unknown>;
  agent?: (options?: unknown) => {
    execute: (instructionOrOptions: unknown) => Promise<unknown>;
  };
  context: {
    pages: () => unknown[];
    addInitScript?: (script: string) => Promise<unknown>;
    exposeBinding?: (
      name: string,
      callback: (...args: unknown[]) => unknown,
    ) => Promise<unknown>;
  };
  close?: () => Promise<void>;
};

type StagehandModule = {
  Stagehand: new (config: {
    env: "LOCAL";
    model: StagehandModelConfig;
    verbose: 0 | 1 | 2;
    experimental?: boolean;
    localBrowserLaunchOptions?: {
      headless?: boolean;
    };
  }) => StagehandInstance;
};

interface StagehandDeps {
  loadStagehand: () => Promise<StagehandModule>;
  env: NodeJS.ProcessEnv;
}

const defaultStagehandDeps: StagehandDeps = {
  loadStagehand: () =>
    import("@browserbasehq/stagehand") as Promise<StagehandModule>,
  env: process.env,
};

interface StagehandObservedAction {
  selector: string;
  description: string;
  method?: string;
  arguments?: string[];
}

interface StandaloneStagehandController {
  act(instruction: string): Promise<string>;
  observe(instruction: string): Promise<string>;
  observeActions(instruction: string): Promise<StagehandObservedAction[]>;
  evaluate<T = unknown>(expression: string): Promise<T>;
  waitForTimeout(ms: number): Promise<void>;
  close(): Promise<void>;
}

export interface StandaloneStagehandAgent {
  execute(instructionOrOptions: unknown): Promise<unknown>;
  evaluate<T = unknown>(expression: string): Promise<T>;
  waitForTimeout(ms: number): Promise<void>;
  drainCapturedEvents(): Promise<unknown[]>;
  getCaptureDiagnostics(): Promise<{
    capturedEvents: unknown[];
    rawDataLayerEvents: unknown[];
  }>;
  close(): Promise<void>;
}

const DATA_LAYER_BINDING_NAME = "__trackingAgentDlPush";
const DATA_LAYER_INIT_SCRIPT = `(() => {
  const storageKey = '__tracking_agent_dl_events__';
  const w = window;
  if (w.__dl_intercepted) return;
  w.__dl_intercepted = true;

  // Capture original push BEFORE any patching so patchLayer and the
  // Array.prototype override both use it — prevents double-fire.
  const nativePush = Array.prototype.push;

  const loadPersisted = () => {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const persist = (item) => {
    try {
      const persisted = loadPersisted();
      nativePush.call(persisted, item);
      sessionStorage.setItem(storageKey, JSON.stringify(persisted));
    } catch {}
    try {
      if (typeof w.${DATA_LAYER_BINDING_NAME} === 'function') {
        void w.${DATA_LAYER_BINDING_NAME}(JSON.stringify(item));
      }
    } catch {}
  };

  const patchLayer = (layer) => {
    if (!Array.isArray(layer)) return [];
    if (layer.__trackingAgentPatched) return layer;
    Object.defineProperty(layer, '__trackingAgentPatched', {
      value: true,
      configurable: true,
      enumerable: false,
    });
    for (const item of layer) persist(item);
    // Use nativePush so this call does NOT re-trigger the Array.prototype override.
    const nativePushOnLayer = nativePush.bind(layer);
    layer.push = function(...items) {
      for (const item of items) persist(item);
      return nativePushOnLayer(...items);
    };
    return layer;
  };

  if (!Array.prototype.__trackingAgentDataLayerPatched) {
    Object.defineProperty(Array.prototype, '__trackingAgentDataLayerPatched', {
      value: true,
      configurable: true,
      enumerable: false,
    });
    Array.prototype.push = function(...items) {
      if (this === w.dataLayer) {
        for (const item of items) persist(item);
      }
      return nativePush.apply(this, items);
    };
  }

  let current = patchLayer(Array.isArray(w.dataLayer) ? w.dataLayer : []);
  Object.defineProperty(w, 'dataLayer', {
    configurable: true,
    get() {
      return current;
    },
    set(value) {
      current = patchLayer(Array.isArray(value) ? value : []);
    },
  });
  if (!Array.isArray(current)) {
    current = [];
    w.dataLayer = current;
  }
})();`;

const DATA_LAYER_DRAIN_SCRIPT = `(() => {
  const storageKey = '__tracking_agent_dl_events__';
  try {
    const persisted = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
    sessionStorage.removeItem(storageKey);
    return JSON.stringify(Array.isArray(persisted) ? persisted : []);
  } catch {}
  return JSON.stringify([]);
})()`;

const DATA_LAYER_SNAPSHOT_SCRIPT = `(() => {
  const w = window;
  const events = Array.isArray(w.dataLayer) ? Array.from(w.dataLayer) : [];
  return JSON.stringify(events);
})()`;

type StagehandPageLike = {
  goto?: (url: string) => Promise<unknown>;
  evaluate?: <T = unknown>(expression: string) => Promise<T>;
  waitForTimeout?: (ms: number) => Promise<void>;
  addInitScript?: (script: string) => Promise<unknown>;
  exposeBinding?: (
    name: string,
    callback: (...args: unknown[]) => unknown,
  ) => Promise<unknown>;
};

type StagehandContextLike = StagehandInstance["context"];

type CdpSessionLike = {
  send: (method: string, params?: object) => Promise<unknown>;
  on: (event: string, handler: (params: unknown) => void) => void;
};

async function tryInstallCdpBinding(
  context: StagehandContextLike,
  page: StagehandPageLike,
  name: string,
  onCall: (payload: string) => void,
  debug: boolean,
): Promise<boolean> {
  try {
    // Stagehand v3: context.conn is the root CdpConnection, page has sendCDP + getSessionForFrame
    const v3Page = page as unknown as {
      sendCDP?: (method: string, params?: object) => Promise<unknown>;
      mainFrameId?: () => string;
      getSessionForFrame?: (frameId: string) => CdpSessionLike;
    };
    // Use the page-level session (scoped to the tab)
    const frameId = v3Page.mainFrameId?.();
    const session: CdpSessionLike | undefined =
      frameId && v3Page.getSessionForFrame
        ? v3Page.getSessionForFrame(frameId)
        : undefined;
    if (!session) return false;

    await session.send("Runtime.enable");
    await session.send("Runtime.addBinding", { name });
    session.on("Runtime.bindingCalled", (params: unknown) => {
      const p = params as { name?: string; payload?: string };
      if (p.name === name && typeof p.payload === "string") {
        onCall(p.payload);
      }
    });
    if (debug) process.stderr.write(`[capture] CDP binding installed via page session\n`);
    return true;
  } catch (err) {
    if (debug) process.stderr.write(`[capture] CDP binding failed: ${err}\n`);
    return false;
  }
}

async function installDataLayerCapture(
  context: StagehandContextLike,
  page: StagehandPageLike,
): Promise<{
  drainCapturedEvents: () => Promise<unknown[]>;
  getCaptureDiagnostics: () => Promise<{
    capturedEvents: unknown[];
    rawDataLayerEvents: unknown[];
  }>;
}> {
  const capturedEvents: unknown[] = [];
  const captureHistory: unknown[] = [];
  const debugCapture = process.env["TRACKING_AGENT_DEBUG_CAPTURE"] === "1";
  const capture = (...args: unknown[]) => {
    const event = args.at(-1);
    capturedEvents.push(event);
    captureHistory.push(event);
    if (debugCapture) {
      const name =
        event && typeof event === "object"
          ? ((event as Record<string, unknown>)["event"] ?? "(no event)")
          : "(no event)";
      process.stderr.write(`[capture] +${name}\n`);
    }
  };
  // Try CDP binding first (Stagehand v3 — no exposeBinding).
  // Fall back to exposeBinding for Playwright-direct and test environments.
  const cdpInstalled = await tryInstallCdpBinding(
    context,
    page,
    DATA_LAYER_BINDING_NAME,
    (payload: string) => {
      try {
        capture(null, JSON.parse(payload));
      } catch {}
    },
    debugCapture,
  );
  if (!cdpInstalled) {
    const exposeTarget = context.exposeBinding ?? page.exposeBinding;
    if (exposeTarget) {
      await exposeTarget(DATA_LAYER_BINDING_NAME, capture);
      if (debugCapture) process.stderr.write(`[capture] exposeBinding fallback installed\n`);
    }
  }

  if (context.addInitScript) {
    await context.addInitScript(DATA_LAYER_INIT_SCRIPT);
  } else {
    if (!page.addInitScript) {
      throw new Error(
        "Stagehand page does not expose addInitScript; cannot install dataLayer capture.",
      );
    }
    await page.addInitScript(DATA_LAYER_INIT_SCRIPT);
  }

  return {
    async drainCapturedEvents(): Promise<unknown[]> {
      const drained = capturedEvents.splice(0);
      if (!page.evaluate) return dedupeEvents(drained);
      try {
        const raw = await page.evaluate<string>(DATA_LAYER_DRAIN_SCRIPT);
        const parsed = JSON.parse(raw) as unknown[];
        if (!Array.isArray(parsed)) return dedupeEvents(drained);
        return dedupeEvents([...drained, ...parsed]);
      } catch {
        return dedupeEvents(drained);
      }
    },
    async getCaptureDiagnostics(): Promise<{
      capturedEvents: unknown[];
      rawDataLayerEvents: unknown[];
    }> {
      let rawDataLayerEvents: unknown[] = [];
      if (page.evaluate) {
        try {
          const raw = await page.evaluate<string>(DATA_LAYER_SNAPSHOT_SCRIPT);
          const parsed = JSON.parse(raw) as unknown[];
          if (Array.isArray(parsed)) {
            rawDataLayerEvents = parsed;
          }
        } catch {
          rawDataLayerEvents = [];
        }
      }
      return {
        capturedEvents: dedupeEvents(captureHistory),
        rawDataLayerEvents,
      };
    },
  };
}

function dedupeEvents(events: unknown[]): unknown[] {
  const seen = new Set<string>();
  const deduped: unknown[] = [];
  for (const event of events) {
    const key = JSON.stringify(event);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(event);
  }
  return deduped;
}

type HybridAgentModelConfig = {
  modelName: string;
  project: string;
  location: string;
};

type HybridAgentOptions = {
  mode: "hybrid";
  model: string | HybridAgentModelConfig;
  executionModel: string | HybridAgentModelConfig;
};

function hasGoogleGenerativeApiKey(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env["GEMINI_API_KEY"] ||
    env["GOOGLE_GENERATIVE_AI_API_KEY"] ||
    env["GOOGLE_API_KEY"],
  );
}

export function resolvePreferredStagehandHybridAgentOptions(
  env: NodeJS.ProcessEnv = process.env,
): HybridAgentOptions {
  const executionModelName =
    env["STAGEHAND_EXECUTION_MODEL"] ?? "vertex/gemini-2.5-pro";
  const vertexProject = env["STAGEHAND_PROJECT"];
  const vertexAgentLocation = env["STAGEHAND_AGENT_LOCATION"] ?? "global";
  const vertexExecutionLocation =
    env["STAGEHAND_EXECUTION_LOCATION"] ?? "us-central1";

  if (hasGoogleGenerativeApiKey(env)) {
    return {
      mode: "hybrid",
      model: env["STAGEHAND_AGENT_MODEL"] ?? "google/gemini-3-flash-preview",
      executionModel: executionModelName,
    };
  }

  if (!vertexProject) {
    throw new Error(
      "Stagehand hybrid Vertex fallback requires STAGEHAND_PROJECT.",
    );
  }

  return {
    mode: "hybrid",
    model: {
      modelName:
        env["STAGEHAND_AGENT_MODEL"] ?? "vertex/gemini-3-flash-preview",
      project: vertexProject,
      location: vertexAgentLocation,
    },
    executionModel: {
      modelName: executionModelName,
      project: vertexProject,
      location: vertexExecutionLocation,
    },
  };
}

export async function createStandaloneStagehandController(
  url: string,
  options: {
    headless?: boolean;
  } = {},
  deps: Pick<StagehandDeps, "loadStagehand" | "env"> = defaultStagehandDeps,
): Promise<StandaloneStagehandController> {
  const { Stagehand } = await deps.loadStagehand();
  const { model, experimental } = await resolveStagehandModelConfig(deps.env);
  const stagehand = new Stagehand({
    env: "LOCAL",
    experimental,
    localBrowserLaunchOptions: {
      headless: options.headless ?? true,
    },
    model,
    verbose: 0,
  });
  await stagehand.init();

  const context = stagehand.context as StagehandContextLike;
  const page = context.pages()[0] as StagehandPageLike | undefined;
  if (!page) throw new Error("Could not resolve an active Stagehand page.");
  if (!page.goto) {
    throw new Error("Could not navigate the active Stagehand page.");
  }
  await page.goto(url);

  return {
    async act(instruction: string): Promise<string> {
      const result = await stagehand.act(instruction, { page });
      return typeof result === "string" ? result : "Stagehand act complete";
    },
    async observeActions(
      instruction: string,
    ): Promise<StagehandObservedAction[]> {
      const result = await stagehand.observe(instruction, { page });
      return Array.isArray(result) ? (result as StagehandObservedAction[]) : [];
    },
    async observe(instruction: string): Promise<string> {
      const result = await stagehand.observe(instruction, { page });
      return JSON.stringify(result, null, 2);
    },
    async evaluate<T = unknown>(expression: string): Promise<T> {
      if (!page.evaluate) {
        throw new Error("Could not evaluate in the active Stagehand page.");
      }
      return page.evaluate<T>(expression);
    },
    async waitForTimeout(ms: number): Promise<void> {
      await page.waitForTimeout?.(ms);
    },
    async close(): Promise<void> {
      await stagehand.close?.();
    },
  };
}

export async function createStandaloneStagehandAgent(
  url: string,
  options: {
    headless?: boolean;
    agentOptions?: unknown;
  } = {},
  deps: Pick<StagehandDeps, "loadStagehand" | "env"> = defaultStagehandDeps,
): Promise<StandaloneStagehandAgent> {
  const { Stagehand } = await deps.loadStagehand();
  const { model, experimental } = await resolveStagehandModelConfig(deps.env);
  const stagehand = new Stagehand({
    env: "LOCAL",
    experimental,
    localBrowserLaunchOptions: {
      headless: options.headless ?? true,
    },
    model,
    verbose: 0,
  });
  await stagehand.init();

  const context = stagehand.context as StagehandContextLike;
  const page = context.pages()[0] as StagehandPageLike | undefined;
  if (!page) throw new Error("Could not resolve an active Stagehand page.");
  if (!page.goto) {
    throw new Error("Could not navigate the active Stagehand page.");
  }
  const dataLayerCapture = await installDataLayerCapture(context, page);
  await page.goto(url);

  if (!stagehand.agent) {
    throw new Error("The installed Stagehand version does not expose agent().");
  }
  const agent = stagehand.agent(options.agentOptions);

  return {
    async execute(instructionOrOptions: unknown): Promise<unknown> {
      return agent.execute(instructionOrOptions);
    },
    async evaluate<T = unknown>(expression: string): Promise<T> {
      if (!page.evaluate) {
        throw new Error("Could not evaluate in the active Stagehand page.");
      }
      return page.evaluate<T>(expression);
    },
    async waitForTimeout(ms: number): Promise<void> {
      await page.waitForTimeout?.(ms);
    },
    async drainCapturedEvents(): Promise<unknown[]> {
      return dataLayerCapture.drainCapturedEvents();
    },
    async getCaptureDiagnostics(): Promise<{
      capturedEvents: unknown[];
      rawDataLayerEvents: unknown[];
    }> {
      return dataLayerCapture.getCaptureDiagnostics();
    },
    async close(): Promise<void> {
      await stagehand.close?.();
    },
  };
}

export async function createStandaloneStagehandSession(
  url: string,
  deps: Pick<StagehandDeps, "loadStagehand" | "env"> = defaultStagehandDeps,
): Promise<StandaloneStagehandController> {
  return createStandaloneStagehandController(url, {}, deps);
}
