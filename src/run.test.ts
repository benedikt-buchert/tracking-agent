import { describe, expect, it, vi } from "vitest";
import { handleMainError, loadEnvIfPresent, run } from "./run.js";

describe("loadEnvIfPresent", () => {
  it("calls the loader when it succeeds", () => {
    const loadEnvFile = vi.fn();
    loadEnvIfPresent(loadEnvFile);
    expect(loadEnvFile).toHaveBeenCalledTimes(1);
  });

  it("swallows missing-env loader failures", () => {
    const loadEnvFile = vi.fn(() => {
      throw new Error("no .env");
    });
    expect(() => loadEnvIfPresent(loadEnvFile)).not.toThrow();
  });
});

describe("handleMainError", () => {
  it("uses process.stderr.write when no write function is provided", () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    handleMainError(new Error("default write test"));

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("default write test"),
    );
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("writes configuration errors without a prefixed label", () => {
    const write = vi.fn();
    const exit = vi.fn(() => {
      throw new Error("exit");
    });
    const configurationError = new Error("missing key");
    configurationError.name = "ConfigurationError";

    expect(() =>
      handleMainError(configurationError, write, exit as never),
    ).toThrow("exit");
    expect(write).toHaveBeenCalledWith("missing key");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("formats generic errors with an Error prefix", () => {
    const write = vi.fn();
    const exit = vi.fn(() => {
      throw new Error("exit");
    });

    expect(() =>
      handleMainError(new Error("boom"), write, exit as never),
    ).toThrow("exit");
    expect(write).toHaveBeenCalledWith("Error: boom\n");
  });

  it("formats non-Error throw values", () => {
    const write = vi.fn();
    const exit = vi.fn(() => {
      throw new Error("exit");
    });

    expect(() => handleMainError("bad", write, exit as never)).toThrow("exit");
    expect(write).toHaveBeenCalledWith("Error: bad\n");
  });
});

describe("run", () => {
  it("awaits main before returning", async () => {
    const loadEnvFile = vi.fn();
    const steps: string[] = [];
    const mainFn = vi.fn(async () => {
      await Promise.resolve();
      steps.push("main");
    });

    await run(
      mainFn,
      loadEnvFile,
      vi.fn(() => {
        throw new Error("should not be called");
      }),
    );

    expect(loadEnvFile).toHaveBeenCalledTimes(1);
    expect(mainFn).toHaveBeenCalledTimes(1);
    expect(steps).toEqual(["main"]);
  });

  it("routes main failures through the shared error handler", async () => {
    const error = new Error("boom");
    const onError = vi.fn(() => {
      throw new Error("handled");
    });

    await expect(
      run(
        async () => {
          throw error;
        },
        vi.fn(),
        onError,
      ),
    ).rejects.toThrow("handled");
    expect(onError).toHaveBeenCalledWith(error);
  });
});
