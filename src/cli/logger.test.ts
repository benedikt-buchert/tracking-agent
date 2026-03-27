import { describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger.js";

describe("createLogger", () => {
  it("defaults to normal verbosity", () => {
    const log = createLogger();
    expect(log.verbosity).toBe("normal");
  });

  it("accepts a verbosity level", () => {
    const log = createLogger("verbose");
    expect(log.verbosity).toBe("verbose");
  });

  describe("quiet mode", () => {
    it("suppresses info messages", () => {
      const out = vi.fn();
      const log = createLogger("quiet", out);
      log.info("hello");
      expect(out).not.toHaveBeenCalled();
    });

    it("suppresses verbose messages", () => {
      const out = vi.fn();
      const log = createLogger("quiet", out);
      log.verbose("hello");
      expect(out).not.toHaveBeenCalled();
    });

    it("still writes warn messages", () => {
      const out = vi.fn();
      const log = createLogger("quiet", out);
      log.warn("oops");
      expect(out).toHaveBeenCalledWith("oops");
    });

    it("still writes error messages", () => {
      const out = vi.fn();
      const log = createLogger("quiet", out);
      log.error("fail");
      expect(out).toHaveBeenCalledWith("fail");
    });
  });

  describe("normal mode", () => {
    it("writes info messages", () => {
      const out = vi.fn();
      const log = createLogger("normal", out);
      log.info("hello");
      expect(out).toHaveBeenCalledWith("hello");
    });

    it("suppresses verbose messages", () => {
      const out = vi.fn();
      const log = createLogger("normal", out);
      log.verbose("detail");
      expect(out).not.toHaveBeenCalled();
    });

    it("writes warn messages", () => {
      const out = vi.fn();
      const log = createLogger("normal", out);
      log.warn("oops");
      expect(out).toHaveBeenCalledWith("oops");
    });
  });

  describe("verbose mode", () => {
    it("writes info messages", () => {
      const out = vi.fn();
      const log = createLogger("verbose", out);
      log.info("hello");
      expect(out).toHaveBeenCalledWith("hello");
    });

    it("writes verbose messages", () => {
      const out = vi.fn();
      const log = createLogger("verbose", out);
      log.verbose("detail");
      expect(out).toHaveBeenCalledWith("detail");
    });

    it("writes warn messages", () => {
      const out = vi.fn();
      const log = createLogger("verbose", out);
      log.warn("oops");
      expect(out).toHaveBeenCalledWith("oops");
    });
  });
});
