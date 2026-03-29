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

describe("createStandaloneStagehandSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lets Stagehand own the page and navigates it before acting", async () => {
    const goto = vi.fn().mockResolvedValue(undefined);
    const page = { goto };
    const init = vi.fn().mockResolvedValue(undefined);
    const act = vi.fn().mockResolvedValue("clicked checkout");
    const observe = vi.fn().mockResolvedValue([{ description: "checkout" }]);
    const close = vi.fn().mockResolvedValue(undefined);

    class StagehandMock {
      init = init;
      act = act;
      observe = observe;
      close = close;
      context = {
        pages: () => [page],
      };
    }

    const bridge = await createStandaloneStagehandSession(
      "https://example.com/checkout",
      {
        loadStagehand: async () => ({ Stagehand: StagehandMock }),
        env: { STAGEHAND_MODEL: "openai/gpt-4.1-mini" },
      },
    );

    await expect(bridge.observe("find checkout")).resolves.toBe(
      JSON.stringify([{ description: "checkout" }], null, 2),
    );
    await expect(bridge.act("click checkout")).resolves.toBe(
      "clicked checkout",
    );

    expect(init).toHaveBeenCalledTimes(1);
    expect(goto).toHaveBeenCalledWith("https://example.com/checkout");
    expect(observe).toHaveBeenCalledWith("find checkout", { page });
    expect(act).toHaveBeenCalledWith("click checkout", { page });
  });

  it("supports headed/headless launch options and page evaluation", async () => {
    const goto = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockResolvedValue("https://example.com/checkout");
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);
    const page = { goto, evaluate, waitForTimeout };
    const capturedConfigs: unknown[] = [];

    class StagehandMock {
      constructor(config: unknown) {
        capturedConfigs.push(config);
      }
      init = vi.fn().mockResolvedValue(undefined);
      act = vi.fn().mockResolvedValue("ok");
      observe = vi.fn().mockResolvedValue([]);
      close = vi.fn().mockResolvedValue(undefined);
      context = {
        pages: () => [page],
      };
    }

    const controller = await createStandaloneStagehandController(
      "https://example.com/checkout",
      { headless: false },
      {
        loadStagehand: async () => ({ Stagehand: StagehandMock }),
        env: { STAGEHAND_MODEL: "openai/gpt-4.1-mini" },
      },
    );

    await expect(controller.evaluate("window.location.href")).resolves.toBe(
      "https://example.com/checkout",
    );
    await expect(controller.waitForTimeout(250)).resolves.toBe(undefined);
    expect(evaluate).toHaveBeenCalledWith("window.location.href");
    expect(waitForTimeout).toHaveBeenCalledWith(250);
    expect(capturedConfigs[0]).toMatchObject({
      localBrowserLaunchOptions: { headless: false },
    });
  });

  it("returns structured observed actions for standalone sessions", async () => {
    const goto = vi.fn().mockResolvedValue(undefined);
    const observedActions = [
      {
        selector: "#email",
        description: "Email address field",
        method: "fill",
        arguments: ["max@example.com"],
      },
    ];
    const page = { goto, evaluate: vi.fn(), waitForTimeout: vi.fn() };

    class StagehandMock {
      init = vi.fn().mockResolvedValue(undefined);
      act = vi.fn().mockResolvedValue("ok");
      observe = vi.fn().mockResolvedValue(observedActions);
      close = vi.fn().mockResolvedValue(undefined);
      context = {
        pages: () => [page],
      };
    }

    const controller = await createStandaloneStagehandController(
      "https://example.com/checkout",
      {},
      {
        loadStagehand: async () => ({ Stagehand: StagehandMock }),
        env: { STAGEHAND_MODEL: "openai/gpt-4.1-mini" },
      },
    );

    await expect(
      controller.observeActions("find the active checkout form fields"),
    ).resolves.toEqual(observedActions);
  });

  it("creates a standalone Stagehand agent and delegates execute()", async () => {
    const goto = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockResolvedValue("https://example.com/checkout");
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);
    const addInitScript = vi.fn().mockResolvedValue(undefined);
    const exposeBinding = vi.fn().mockImplementation((_name, callback) => {
      callback(undefined, { event: "pageview" });
      return Promise.resolve(undefined);
    });
    const execute = vi.fn().mockResolvedValue({
      success: true,
      completed: true,
    });
    const page = {
      goto,
      evaluate,
      waitForTimeout,
      addInitScript,
      exposeBinding,
    };
    const capturedAgentOptions: unknown[] = [];

    class StagehandMock {
      init = vi.fn().mockResolvedValue(undefined);
      act = vi.fn().mockResolvedValue("ok");
      observe = vi.fn().mockResolvedValue([]);
      agent = vi.fn().mockImplementation((options?: unknown) => {
        capturedAgentOptions.push(options);
        return { execute };
      });
      close = vi.fn().mockResolvedValue(undefined);
      context = {
        pages: () => [page],
        addInitScript,
        exposeBinding,
      };
    }

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
      {
        loadStagehand: async () => ({ Stagehand: StagehandMock }),
        env: { STAGEHAND_MODEL: "openai/gpt-4.1-mini" },
      },
    );

    await expect(
      agent.execute({ instruction: "purchase a product", maxSteps: 5 }),
    ).resolves.toEqual({
      success: true,
      completed: true,
    });
    await expect(agent.evaluate("window.location.href")).resolves.toBe(
      "https://example.com/checkout",
    );
    await expect(agent.waitForTimeout(250)).resolves.toBe(undefined);
    await expect(agent.drainCapturedEvents()).resolves.toEqual([
      { event: "pageview" },
    ]);
    await expect(agent.drainCapturedEvents()).resolves.toEqual([]);
    expect(goto).toHaveBeenCalledWith("https://example.com/checkout");
    expect(addInitScript).toHaveBeenCalledOnce();
    expect(exposeBinding).toHaveBeenCalledOnce();
    expect(capturedAgentOptions).toEqual([
      {
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

    class StagehandMock {
      constructor(config: unknown) {
        capturedConfigs.push(config);
      }
      init = vi.fn().mockResolvedValue(undefined);
      act = vi.fn().mockResolvedValue("ok");
      observe = vi.fn().mockResolvedValue([]);
      close = vi.fn().mockResolvedValue(undefined);
      context = {
        pages: () => [{ goto: vi.fn().mockResolvedValue(undefined) }],
      };
    }

    try {
      await createStandaloneStagehandController(
        "https://example.com/checkout",
        {},
        {
          loadStagehand: async () => ({ Stagehand: StagehandMock }),
          env: {
            STAGEHAND_MODEL: "vertex/gemini-2.5-flash",
            STAGEHAND_PROJECT: "test-project",
            GOOGLE_APPLICATION_CREDENTIALS: path,
          },
        },
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
    const goto = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify([{ event: "pageview" }]))
      .mockResolvedValueOnce(JSON.stringify([]));
    const addInitScript = vi.fn().mockResolvedValue(undefined);
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);
    const execute = vi
      .fn()
      .mockResolvedValue({ success: true, completed: true });
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

    const agent = await createStandaloneStagehandAgent(
      "https://example.com/checkout",
      {},
      {
        loadStagehand: async () => ({ Stagehand: StagehandMock }),
        env: { STAGEHAND_MODEL: "openai/gpt-4.1-mini" },
      },
    );

    await expect(agent.drainCapturedEvents()).resolves.toEqual([
      { event: "pageview" },
    ]);
    await expect(agent.drainCapturedEvents()).resolves.toEqual([]);
  });

  it("fails loudly when no init-script hook is available for dataLayer capture", async () => {
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue("https://example.com/checkout"),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };

    class StagehandMock {
      init = vi.fn().mockResolvedValue(undefined);
      act = vi.fn().mockResolvedValue("ok");
      observe = vi.fn().mockResolvedValue([]);
      agent = vi.fn().mockReturnValue({ execute: vi.fn() });
      close = vi.fn().mockResolvedValue(undefined);
      context = {
        pages: () => [page],
      };
    }

    await expect(
      createStandaloneStagehandAgent(
        "https://example.com/checkout",
        {},
        {
          loadStagehand: async () => ({ Stagehand: StagehandMock }),
          env: { STAGEHAND_MODEL: "openai/gpt-4.1-mini" },
        },
      ),
    ).rejects.toThrow(/addInitScript/);
  });

  it("captures dataLayer events pushed through Array.prototype.push.bind(window.dataLayer)", async () => {
    const goto = vi.fn().mockResolvedValue(undefined);
    let script = "";
    const addInitScript = vi.fn().mockImplementation(async (value: string) => {
      script = value;
    });
    type SessionStorageMock = {
      store: Map<string, string>;
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
      removeItem(key: string): void;
    };
    const sessionStorage: SessionStorageMock = {
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
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn().mockImplementation(async () => {
      const currentScript = script;
      const run = new Function("window", "sessionStorage", currentScript) as (
        window: Record<string, unknown>,
        sessionStorage: SessionStorageMock,
      ) => void;
      run(windowLike, sessionStorage);
      const originalPush = Array.prototype.push.bind(
        windowLike.dataLayer as unknown[],
      );
      originalPush({ event: "addToCart" });
      return { success: true, completed: true };
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

    const agent = await createStandaloneStagehandAgent(
      "https://example.com/checkout",
      {},
      {
        loadStagehand: async () => ({ Stagehand: StagehandMock }),
        env: { STAGEHAND_MODEL: "openai/gpt-4.1-mini" },
      },
    );

    await agent.execute({ instruction: "test", maxSteps: 1 });
    await expect(agent.drainCapturedEvents()).resolves.toEqual([
      { event: "addToCart" },
    ]);
  });

  it("returns collector diagnostics alongside the raw final dataLayer snapshot", async () => {
    const goto = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify([
          { event: "pageview" },
          { event: "view_promotion" },
          { event: "addToCart" },
        ]),
      );
    const addInitScript = vi.fn().mockResolvedValue(undefined);
    const exposeBinding = vi.fn().mockImplementation((_name, callback) => {
      callback(undefined, { event: "pageview" });
      callback(undefined, { event: "view_promotion" });
      return Promise.resolve(undefined);
    });
    const execute = vi
      .fn()
      .mockResolvedValue({ success: true, completed: true });
    const page = {
      goto,
      evaluate,
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      addInitScript,
      exposeBinding,
    };

    class StagehandMock {
      init = vi.fn().mockResolvedValue(undefined);
      act = vi.fn().mockResolvedValue("ok");
      observe = vi.fn().mockResolvedValue([]);
      agent = vi.fn().mockReturnValue({ execute });
      close = vi.fn().mockResolvedValue(undefined);
      context = {
        pages: () => [page],
        addInitScript,
        exposeBinding,
      };
    }

    const agent = await createStandaloneStagehandAgent(
      "https://example.com/checkout",
      {},
      {
        loadStagehand: async () => ({ Stagehand: StagehandMock }),
        env: { STAGEHAND_MODEL: "openai/gpt-4.1-mini" },
      },
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
    const goto = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi
      .fn()
      .mockResolvedValue(JSON.stringify([{ event: "addToCart" }]));
    const addInitScript = vi.fn().mockResolvedValue(undefined);
    const exposeBinding = vi.fn().mockImplementation((_name, callback) => {
      callback(undefined, { event: "pageview" });
      return Promise.resolve(undefined);
    });
    const execute = vi
      .fn()
      .mockResolvedValue({ success: true, completed: true });
    const page = {
      goto,
      evaluate,
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      addInitScript,
      exposeBinding,
    };

    class StagehandMock {
      init = vi.fn().mockResolvedValue(undefined);
      act = vi.fn().mockResolvedValue("ok");
      observe = vi.fn().mockResolvedValue([]);
      agent = vi.fn().mockReturnValue({ execute });
      close = vi.fn().mockResolvedValue(undefined);
      context = {
        pages: () => [page],
        addInitScript,
        exposeBinding,
      };
    }

    const agent = await createStandaloneStagehandAgent(
      "https://example.com/checkout",
      {},
      {
        loadStagehand: async () => ({ Stagehand: StagehandMock }),
        env: { STAGEHAND_MODEL: "openai/gpt-4.1-mini" },
      },
    );

    await expect(agent.drainCapturedEvents()).resolves.toEqual([
      { event: "pageview" },
      { event: "addToCart" },
    ]);
  });
});
