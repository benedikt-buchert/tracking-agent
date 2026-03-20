import { describe, expect, it, vi } from "vitest";
import { ConfigurationError } from "./agent/runtime.js";
import { handleMainError, loadEnvIfPresent } from "./run.js";

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

    expect(() =>
      handleMainError(new ConfigurationError("missing key"), write, exit as never),
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
