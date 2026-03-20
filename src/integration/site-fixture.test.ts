import { describe, it, expect, afterEach } from "vitest";
import { startFixtureSiteServer } from "./site-fixture.js";

describe("startFixtureSiteServer", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) {
      await close();
      close = undefined;
    }
  });

  it("returns a baseUrl with http://127.0.0.1 and a port", async () => {
    const server = await startFixtureSiteServer();
    close = server.close;
    expect(server.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("serves index.html at the root path with text/html content-type", async () => {
    const server = await startFixtureSiteServer();
    close = server.close;

    const res = await fetch(`${server.baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("serves .js files with text/javascript content-type", async () => {
    const server = await startFixtureSiteServer();
    close = server.close;

    const res = await fetch(`${server.baseUrl}/shared/fixture-store.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
  });

  it("serves .css files with text/css content-type", async () => {
    const server = await startFixtureSiteServer();
    close = server.close;

    const res = await fetch(`${server.baseUrl}/shared/test.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
  });

  it("serves .json files with application/json content-type", async () => {
    const server = await startFixtureSiteServer();
    close = server.close;

    const res = await fetch(`${server.baseUrl}/shared/test.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("resolves trailing slash paths to index.html", async () => {
    const server = await startFixtureSiteServer();
    close = server.close;

    const res = await fetch(`${server.baseUrl}/deterministic/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("returns 404 for a missing file", async () => {
    const server = await startFixtureSiteServer();
    close = server.close;

    const res = await fetch(`${server.baseUrl}/nonexistent-file.html`);
    expect(res.status).toBe(404);
  });

  it("strips query strings when resolving paths", async () => {
    const server = await startFixtureSiteServer();
    close = server.close;

    const res = await fetch(`${server.baseUrl}/?foo=bar`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("serves non-root HTML pages correctly", async () => {
    const server = await startFixtureSiteServer();
    close = server.close;

    const res = await fetch(`${server.baseUrl}/deterministic/checkout.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("close() resolves without error", async () => {
    const server = await startFixtureSiteServer();
    close = undefined;
    await expect(server.close()).resolves.toBeUndefined();
  });
});
