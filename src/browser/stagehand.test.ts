import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import {
  createStandaloneStagehandAgent,
  createStandaloneStagehandController,
  createStandaloneStagehandSession,
  isStagehandExperimentalBackendEnabled,
  resolvePreferredStagehandHybridAgentOptions,
  resolveStagehandModel,
} from "./stagehand.js";

// ── Shared mock helpers ─────────────────────────────────────────────────────

type SessionStorageMock = {
  store: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function makeSessionStorage(): SessionStorageMock {
  return {
    store: new Map<string, string>(),
    getItem(key: string) {
      return this.store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      this.store.set(key, value);
    },
    removeItem(key: string) {
      this.store.delete(key);
    },
  };
}

function makePage(
  overrides: Partial<{
    goto: ReturnType<typeof vi.fn>;
    evaluate: ReturnType<typeof vi.fn>;
    waitForTimeout: ReturnType<typeof vi.fn>;
    addInitScript: ReturnType<typeof vi.fn>;
    exposeBinding: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return {
    goto: overrides.goto ?? vi.fn().mockResolvedValue(undefined),
    evaluate:
      overrides.evaluate ??
      vi.fn().mockResolvedValue("https://example.com/checkout"),
    waitForTimeout:
      overrides.waitForTimeout ?? vi.fn().mockResolvedValue(undefined),
    ...(overrides.addInitScript !== undefined && {
      addInitScript: overrides.addInitScript,
    }),
    ...(overrides.exposeBinding !== undefined && {
      exposeBinding: overrides.exposeBinding,
    }),
  };
}

function makeStagehandMock(
  page: ReturnType<typeof makePage>,
  overrides: Partial<{
    act: ReturnType<typeof vi.fn>;
    observe: ReturnType<typeof vi.fn>;
    agent: ReturnType<typeof vi.fn>;
    contextExtras: Record<string, unknown>;
  }> = {},
) {
  return class StagehandMock {
    init = vi.fn().mockResolvedValue(undefined);
    act = overrides.act ?? vi.fn().mockResolvedValue("ok");
    observe = overrides.observe ?? vi.fn().mockResolvedValue([]);
    agent = overrides.agent ?? vi.fn().mockReturnValue({ execute: vi.fn() });
    close = vi.fn().mockResolvedValue(undefined);
    context = Object.assign(
      { pages: () => [page] },
      (page as Record<string, unknown>).addInitScript
        ? { addInitScript: (page as Record<string, unknown>).addInitScript }
        : {},
      (page as Record<string, unknown>).exposeBinding
        ? { exposeBinding: (page as Record<string, unknown>).exposeBinding }
        : {},
      overrides.contextExtras ?? {},
    );
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stagehandDeps(StagehandMock: any, env?: Record<string, string>) {
  return {
    loadStagehand: async () => ({ Stagehand: StagehandMock }),
    env: env ?? { STAGEHAND_MODEL: "openai/gpt-4.1-mini" },
  };
}

// ── Pure function tests ─────────────────────────────────────────────────────

describe("isStagehandExperimentalBackendEnabled", () => {
  it("returns true only for the stagehand backend flag", () => {
    expect(
      isStagehandExperimentalBackendEnabled({
        EXPERIMENTAL_BROWSER_BACKEND: "stagehand",
      }),
    ).toBe(true);
    expect(
      isStagehandExperimentalBackendEnabled({
        EXPERIMENTAL_BROWSER_BACKEND: "legacy",
      }),
    ).toBe(false);
  });
});

describe("resolveStagehandModel", () => {
  it("prefers an explicit Stagehand model", () => {
    expect(
      resolveStagehandModel({ STAGEHAND_MODEL: "openai/gpt-5-mini" }),
    ).toBe("openai/gpt-5-mini");
  });

  it("throws when no Stagehand model can be resolved", () => {
    expect(() => resolveStagehandModel({})).toThrow(/requires STAGEHAND_MODEL/);
  });
});

describe("resolvePreferredStagehandHybridAgentOptions", () => {
  it("uses the recommended google hybrid model when a Google Generative AI key is present", () => {
    expect(
      resolvePreferredStagehandHybridAgentOptions({
        GOOGLE_GENERATIVE_AI_API_KEY: "test-key",
      }),
    ).toEqual({
      mode: "hybrid",
      model: "google/gemini-3-flash-preview",
      executionModel: "vertex/gemini-2.5-pro",
    });
  });

  it("falls back to Vertex-backed hybrid config when only Vertex auth is available", () => {
    expect(
      resolvePreferredStagehandHybridAgentOptions({
        STAGEHAND_PROJECT: "test-project",
        STAGEHAND_EXECUTION_LOCATION: "europe-west4",
      }),
    ).toEqual({
      mode: "hybrid",
      model: {
        modelName: "vertex/gemini-3-flash-preview",
        project: "test-project",
        location: "global",
      },
      executionModel: {
        modelName: "vertex/gemini-2.5-pro",
        project: "test-project",
        location: "europe-west4",
      },
    });
  });
});

// ── Integration-style tests ─────────────────────────────────────────────────

describe("createStandaloneStagehandSession", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("lets Stagehand own the page and navigates it before acting", async () => {
    const page = makePage();
    const act = vi.fn().mockResolvedValue("clicked checkout");
    const observe = vi.fn().mockResolvedValue([{ description: "checkout" }]);
    const Mock = makeStagehandMock(page, { act, observe });

    const bridge = await createStandaloneStagehandSession(
      "https://example.com/checkout",
      stagehandDeps(Mock),
    );

    await expect(bridge.observe("find checkout")).resolves.toBe(
      JSON.stringify([{ description: "checkout" }], null, 2),
    );
    await expect(bridge.act("click checkout")).resolves.toBe(
      "clicked checkout",
    );
    expect(page.goto).toHaveBeenCalledWith("https://example.com/checkout");
  });

  it("supports headed/headless launch options and page evaluation", async () => {
    const page = makePage();
    const capturedConfigs: unknown[] = [];
    const Mock = makeStagehandMock(page);
    const OrigInit = Mock;
    const Capturing = class extends OrigInit {
      constructor(config: unknown) {
        super();
        capturedConfigs.push(config);
      }
    };

    const controller = await createStandaloneStagehandController(
      "https://example.com/checkout",
      { headless: false },
      stagehandDeps(Capturing),
    );

    await expect(controller.evaluate("window.location.href")).resolves.toBe(
      "https://example.com/checkout",
    );
    await expect(controller.waitForTimeout(250)).resolves.toBe(undefined);
    expect(capturedConfigs[0]).toMatchObject({
      localBrowserLaunchOptions: { headless: false },
    });
  });

  it("returns structured observed actions for standalone sessions", async () => {
    const observedActions = [
      {
        selector: "#email",
        description: "Email address field",
        method: "fill",
        arguments: ["max@example.com"],
      },
    ];
    const page = makePage();
    const Mock = makeStagehandMock(page, {
      observe: vi.fn().mockResolvedValue(observedActions),
    });

    const controller = await createStandaloneStagehandController(
      "https://example.com/checkout",
      {},
      stagehandDeps(Mock),
    );

    await expect(
      controller.observeActions("find the active checkout form fields"),
    ).resolves.toEqual(observedActions);
  });

  // ── Agent + dataLayer capture ───────────────────────────────────────────

  it("creates a standalone Stagehand agent and delegates execute()", async () => {
    const exposeBinding = vi.fn().mockImplementation((_name, callback) => {
      callback(undefined, { event: "pageview" });
      return Promise.resolve(undefined);
    });
    const addInitScript = vi.fn().mockResolvedValue(undefined);
    const page = makePage({ addInitScript, exposeBinding });
    const execute = vi.fn().mockResolvedValue({
      success: true,
      completed: true,
    });
    const capturedAgentOptions: unknown[] = [];
    const Mock = makeStagehandMock(page, {
      agent: vi.fn().mockImplementation((options?: unknown) => {
        capturedAgentOptions.push(options);
        return { execute };
      }),
    });

    const agent = await createStandaloneStagehandAgent(
      "https://example.com/checkout",
      {
        headless: true,
        agentOptions: {
          mode: "hybrid",
          model: {
            modelName: "vertex/gemini-3-flash-preview",
            project: "test-project",
            location: "global",
          },
          executionModel: {
            modelName: "vertex/gemini-2.5-pro",
            project: "test-project",
            location: "europe-west4",
          },
        },
      },
      stagehandDeps(Mock),
    );

    await expect(
      agent.execute({ instruction: "purchase a product", maxSteps: 5 }),
    ).resolves.toEqual({ success: true, completed: true });
    await expect(agent.drainCapturedEvents()).resolves.toEqual([
      { event: "pageview" },
    ]);
    await expect(agent.drainCapturedEvents()).resolves.toEqual([]);
    expect(addInitScript).toHaveBeenCalledOnce();
    expect(exposeBinding).toHaveBeenCalledOnce();
    expect(capturedAgentOptions).toEqual([
      expect.objectContaining({ mode: "hybrid" }),
    ]);
  });

  it("captures events via CDP binding when page exposes mainFrameId and getSessionForFrame", async () => {
    type BindingHandler = (params: unknown) => void;
    let bindingHandler: BindingHandler | undefined;
    const cdpSession = {
      send: vi.fn().mockResolvedValue(undefined),
      on: vi.fn().mockImplementation((_event: string, handler: BindingHandler) => {
        bindingHandler = handler;
      }),
    };
    const addInitScript = vi.fn().mockResolvedValue(undefined);
    const page = Object.assign(makePage({ addInitScript }), {
      mainFrameId: () => "main",
      getSessionForFrame: () => cdpSession,
    });
    const execute = vi.fn().mockImplementation(async () => {
      bindingHandler?.({
        name: "__trackingAgentDlPush",
        payload: JSON.stringify({ event: "add_to_cart" }),
      });
      return { success: true, completed: true };
    });
    const Mock = makeStagehandMock(page, {
      agent: vi.fn().mockReturnValue({ execute }),
    });

    const agent = await createStandaloneStagehandAgent(
      "https://example.com",
      {},
      stagehandDeps(Mock),
    );

    await agent.execute({ instruction: "test", maxSteps: 1 });
    await expect(agent.drainCapturedEvents()).resolves.toEqual([
      { event: "add_to_cart" },
    ]);
    expect(cdpSession.send).toHaveBeenCalledWith("Runtime.enable");
    expect(cdpSession.send).toHaveBeenCalledWith("Runtime.addBinding", {
      name: "__trackingAgentDlPush",
    });
  });

  it("falls back to exposeBinding when CDP session is unavailable", async () => {
    const exposeBinding = vi.fn().mockImplementation((_name, callback) => {
      callback(undefined, { event: "pageview" });
      return Promise.resolve(undefined);
    });
    const addInitScript = vi.fn().mockResolvedValue(undefined);
    const page = makePage({ addInitScript, exposeBinding });
    const execute = vi.fn().mockResolvedValue({ success: true, completed: true });
    const Mock = makeStagehandMock(page, {
      agent: vi.fn().mockReturnValue({ execute }),
    });

    const agent = await createStandaloneStagehandAgent(
      "https://example.com",
      {},
      stagehandDeps(Mock),
    );

    await expect(agent.drainCapturedEvents()).resolves.toEqual([
      { event: "pageview" },
    ]);
    expect(exposeBinding).toHaveBeenCalledOnce();
  });

  it("ignores CDP binding events with mismatched name", async () => {
    type BindingHandler = (params: unknown) => void;
    let bindingHandler: BindingHandler | undefined;
    const cdpSession = {
      send: vi.fn().mockResolvedValue(undefined),
      on: vi.fn().mockImplementation((_event: string, handler: BindingHandler) => {
        bindingHandler = handler;
      }),
    };
    const addInitScript = vi.fn().mockResolvedValue(undefined);
    const page = Object.assign(makePage({ addInitScript }), {
      mainFrameId: () => "main",
      getSessionForFrame: () => cdpSession,
    });
    const execute = vi.fn().mockImplementation(async () => {
      bindingHandler?.({ name: "otherBinding", payload: "{}" });
      bindingHandler?.({
        name: "__trackingAgentDlPush",
        payload: JSON.stringify({ event: "real" }),
      });
      return { success: true, completed: true };
    });
    const Mock = makeStagehandMock(page, {
      agent: vi.fn().mockReturnValue({ execute }),
    });

    const agent = await createStandaloneStagehandAgent(
      "https://example.com",
      {},
      stagehandDeps(Mock),
    );

    await agent.execute({ instruction: "test", maxSteps: 1 });
    await expect(agent.drainCapturedEvents()).resolves.toEqual([
      { event: "real" },
    ]);
  });

  it("builds a Vertex model config from a service account credentials file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stagehand-vertex-"));
    const path = join(dir, "service-account.json");
    writeFileSync(
      path,
      JSON.stringify({
        client_email: "robot@example.iam.gserviceaccount.com",
        private_key:
          "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
      }),
    );
    const capturedConfigs: unknown[] = [];
    const page = makePage();
    const Mock = makeStagehandMock(page);
    const Capturing = class extends Mock {
      constructor(config: unknown) {
        super();
        capturedConfigs.push(config);
      }
    };

    try {
      await createStandaloneStagehandController(
        "https://example.com/checkout",
        {},
        stagehandDeps(Capturing, {
          STAGEHAND_MODEL: "vertex/gemini-2.5-flash",
          STAGEHAND_PROJECT: "test-project",
          GOOGLE_APPLICATION_CREDENTIALS: path,
        }),
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }

    expect(capturedConfigs[0]).toMatchObject({
      experimental: true,
      model: {
        modelName: "vertex/gemini-2.5-flash",
        project: "test-project",
        location: "us-central1",
        googleAuthOptions: {
          credentials: {
            client_email: "robot@example.iam.gserviceaccount.com",
          },
        },
      },
    });
  });

  it("falls back to draining the page buffer when exposeBinding is unavailable", async () => {
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify([{ event: "pageview" }]))
      .mockResolvedValueOnce(JSON.stringify([]));
    const addInitScript = vi.fn().mockResolvedValue(undefined);
    const page = makePage({ evaluate, addInitScript });
    const execute = vi
      .fn()
      .mockResolvedValue({ success: true, completed: true });
    const Mock = makeStagehandMock(page, {
      agent: vi.fn().mockReturnValue({ execute }),
    });

    const agent = await createStandaloneStagehandAgent(
      "https://example.com/checkout",
      {},
      stagehandDeps(Mock),
    );

    await expect(agent.drainCapturedEvents()).resolves.toEqual([
      { event: "pageview" },
    ]);
    await expect(agent.drainCapturedEvents()).resolves.toEqual([]);
  });

  it("fails loudly when no init-script hook is available for dataLayer capture", async () => {
    const page = makePage();
    const Mock = makeStagehandMock(page, {
      agent: vi.fn().mockReturnValue({ execute: vi.fn() }),
    });

    await expect(
      createStandaloneStagehandAgent(
        "https://example.com/checkout",
        {},
        stagehandDeps(Mock),
      ),
    ).rejects.toThrow(/addInitScript/);
  });

  it("captures dataLayer events pushed through Array.prototype.push.bind(window.dataLayer)", async () => {
    let script = "";
    const addInitScript = vi.fn().mockImplementation(async (value: string) => {
      script = value;
    });
    const sessionStorage = makeSessionStorage();
    const windowLike: Record<string, unknown> = {
      dataLayer: [],
      sessionStorage,
    };
    const evaluate = vi.fn().mockImplementation(async (expression: string) => {
      const executor = new Function(
        "window",
        "sessionStorage",
        `return (${expression});`,
      ) as (
        window: Record<string, unknown>,
        sessionStorage: SessionStorageMock,
      ) => unknown;
      return String(executor(windowLike, sessionStorage));
    });
    const execute = vi.fn().mockImplementation(async () => {
      const run = new Function("window", "sessionStorage", script) as (
        window: Record<string, unknown>,
        sessionStorage: SessionStorageMock,
      ) => void;
      run(windowLike, sessionStorage);
      Array.prototype.push.bind(windowLike.dataLayer as unknown[])(
        { event: "addToCart" },
      );
      return { success: true, completed: true };
    });
    const page = makePage({ evaluate, addInitScript });
    const Mock = makeStagehandMock(page, {
      agent: vi.fn().mockReturnValue({ execute }),
    });

    const agent = await createStandaloneStagehandAgent(
      "https://example.com/checkout",
      {},
      stagehandDeps(Mock),
    );

    await agent.execute({ instruction: "test", maxSteps: 1 });
    await expect(agent.drainCapturedEvents()).resolves.toEqual([
      { event: "addToCart" },
    ]);
  });

  it("returns collector diagnostics alongside the raw final dataLayer snapshot", async () => {
    const evaluate = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify([
          { event: "pageview" },
          { event: "view_promotion" },
          { event: "addToCart" },
        ]),
      );
    const exposeBinding = vi.fn().mockImplementation((_name, callback) => {
      callback(undefined, { event: "pageview" });
      callback(undefined, { event: "view_promotion" });
      return Promise.resolve(undefined);
    });
    const addInitScript = vi.fn().mockResolvedValue(undefined);
    const page = makePage({ evaluate, addInitScript, exposeBinding });
    const execute = vi
      .fn()
      .mockResolvedValue({ success: true, completed: true });
    const Mock = makeStagehandMock(page, {
      agent: vi.fn().mockReturnValue({ execute }),
    });

    const agent = await createStandaloneStagehandAgent(
      "https://example.com/checkout",
      {},
      stagehandDeps(Mock),
    );

    await expect(agent.drainCapturedEvents()).resolves.toEqual([
      { event: "pageview" },
      { event: "view_promotion" },
      { event: "addToCart" },
    ]);
    await expect(agent.getCaptureDiagnostics()).resolves.toEqual({
      capturedEvents: [{ event: "pageview" }, { event: "view_promotion" }],
      rawDataLayerEvents: [
        { event: "pageview" },
        { event: "view_promotion" },
        { event: "addToCart" },
      ],
    });
  });

  it("merges binding-captured and fallback-drained events in the same drain", async () => {
    const evaluate = vi
      .fn()
      .mockResolvedValue(JSON.stringify([{ event: "addToCart" }]));
    const exposeBinding = vi.fn().mockImplementation((_name, callback) => {
      callback(undefined, { event: "pageview" });
      return Promise.resolve(undefined);
    });
    const addInitScript = vi.fn().mockResolvedValue(undefined);
    const page = makePage({ evaluate, addInitScript, exposeBinding });
    const execute = vi
      .fn()
      .mockResolvedValue({ success: true, completed: true });
    const Mock = makeStagehandMock(page, {
      agent: vi.fn().mockReturnValue({ execute }),
    });

    const agent = await createStandaloneStagehandAgent(
      "https://example.com/checkout",
      {},
      stagehandDeps(Mock),
    );

    await expect(agent.drainCapturedEvents()).resolves.toEqual([
      { event: "pageview" },
      { event: "addToCart" },
    ]);
  });
});
