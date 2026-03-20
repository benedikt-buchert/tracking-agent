import { describe, it, expect } from "vitest";
import { createTaskList } from "./task-list.js";
import type { EventSchema } from "../schema.js";

const schemas: EventSchema[] = [
  { eventName: "purchase", schemaUrl: "https://example.com/purchase.json" },
  { eventName: "add_to_cart", schemaUrl: "https://example.com/add-to-cart.json" },
  { eventName: "page_view", schemaUrl: "https://example.com/page-view.json" },
];

describe("createTaskList", () => {
  it("initialises all tasks as pending", () => {
    const tl = createTaskList(schemas);
    expect(tl.tasks.every((t) => t.status === "pending")).toBe(true);
  });

  it("reports correct totalCount", () => {
    expect(createTaskList(schemas).totalCount).toBe(3);
  });

  it("reports foundCount of 0 before any update", () => {
    expect(createTaskList(schemas).foundCount).toBe(0);
  });

  it("marks a task found when its event name appears in accumulated events", () => {
    const tl = createTaskList(schemas);
    tl.update([{ event: "purchase", ecommerce: {} }]);
    expect(tl.tasks.find((t) => t.eventName === "purchase")?.status).toBe("found");
  });

  it("does not mark tasks for unknown event names", () => {
    const tl = createTaskList(schemas);
    tl.update([{ event: "unknown_event" }]);
    expect(tl.tasks.every((t) => t.status === "pending")).toBe(true);
  });

  it("update is idempotent — calling twice does not change counts", () => {
    const tl = createTaskList(schemas);
    const events = [{ event: "purchase" }];
    tl.update(events);
    tl.update(events);
    expect(tl.foundCount).toBe(1);
  });

  it("increments foundCount for each distinct found event", () => {
    const tl = createTaskList(schemas);
    tl.update([{ event: "purchase" }, { event: "page_view" }]);
    expect(tl.foundCount).toBe(2);
  });

  it("ignores non-object entries and entries without an event field", () => {
    const tl = createTaskList(schemas);
    tl.update(["string", 42, null, undefined, {}, { event: 123 }]);
    expect(tl.foundCount).toBe(0);
  });

  it("handles an empty accumulated events array", () => {
    const tl = createTaskList(schemas);
    tl.update([]);
    expect(tl.foundCount).toBe(0);
  });

  it("handles empty schema list", () => {
    const tl = createTaskList([]);
    expect(tl.totalCount).toBe(0);
    expect(tl.foundCount).toBe(0);
  });

  describe("format()", () => {
    it("includes the found/total count", () => {
      const tl = createTaskList(schemas);
      tl.update([{ event: "purchase" }]);
      expect(tl.format()).toContain("1/3");
    });

    it("marks found events with a checkmark", () => {
      const tl = createTaskList(schemas);
      tl.update([{ event: "purchase" }]);
      const formatted = tl.format();
      expect(formatted).toMatch(/✓.*purchase/);
    });

    it("marks pending events with a cross", () => {
      const tl = createTaskList(schemas);
      tl.update([{ event: "purchase" }]);
      const formatted = tl.format();
      expect(formatted).toMatch(/✗.*add_to_cart/);
      expect(formatted).toMatch(/✗.*page_view/);
    });

    it("lists pending events before found events", () => {
      const tl = createTaskList(schemas);
      tl.update([{ event: "purchase" }]);
      const formatted = tl.format();
      const pendingIdx = formatted.indexOf("add_to_cart");
      const foundIdx = formatted.indexOf("purchase");
      expect(pendingIdx).toBeLessThan(foundIdx);
    });

    it("returns a non-empty string when all tasks are pending", () => {
      const tl = createTaskList(schemas);
      expect(tl.format().length).toBeGreaterThan(0);
    });

    it("shows 0/0 and no task lines for an empty schema list", () => {
      const tl = createTaskList([]);
      expect(tl.format()).toContain("0/0");
    });
  });

  describe("formatCompact()", () => {
    it("returns a single line with no newlines", () => {
      const tl = createTaskList(schemas);
      expect(tl.formatCompact()).not.toContain("\n");
    });

    it("includes the found/total count", () => {
      const tl = createTaskList(schemas);
      tl.update([{ event: "purchase" }]);
      expect(tl.formatCompact()).toContain("1/3");
    });

    it("marks found events with ✓", () => {
      const tl = createTaskList(schemas);
      tl.update([{ event: "purchase" }]);
      expect(tl.formatCompact()).toMatch(/✓.*purchase/);
    });

    it("marks pending events with ✗", () => {
      const tl = createTaskList(schemas);
      tl.update([{ event: "purchase" }]);
      expect(tl.formatCompact()).toMatch(/✗.*add_to_cart/);
    });

    it("lists pending events before found events", () => {
      const tl = createTaskList(schemas);
      tl.update([{ event: "purchase" }]);
      const s = tl.formatCompact();
      expect(s.indexOf("add_to_cart")).toBeLessThan(s.indexOf("purchase"));
    });

    it("handles empty schema list without throwing", () => {
      expect(() => createTaskList([]).formatCompact()).not.toThrow();
    });
  });
});
