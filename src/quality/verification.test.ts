import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  countEventsByType,
  mergeUniqueEvents,
  resolveSchemaForEvent,
} from "../browser/report.js";
import type { EventSchema } from "../schema.js";

const eventArbitrary = fc.oneof(
  fc.record({ event: fc.string({ maxLength: 24 }), value: fc.integer() }),
  fc.record({ value: fc.integer() }),
  fc.string({ maxLength: 24 }),
  fc.integer(),
  fc.constant(null),
);

describe("verification constraints", () => {
  const urlArbitrary = fc.constantFrom(
    "https://example.com/a",
    "https://example.com/b",
    "https://example.com/c",
  );

  it("countEventsByType preserves total cardinality and does not mutate input", () => {
    fc.assert(
      fc.property(fc.array(eventArbitrary), (events) => {
        const snapshot = structuredClone(events);
        const counts = countEventsByType(events);
        const total = [...counts.values()].reduce(
          (sum, count) => sum + count,
          0,
        );

        expect(total).toBe(events.length);
        expect(events).toEqual(snapshot);
      }),
      { numRuns: 100 },
    );
  });

  it("mergeUniqueEvents matches first-seen JSON uniqueness and does not mutate inputs", () => {
    fc.assert(
      fc.property(
        fc.array(eventArbitrary),
        fc.array(eventArbitrary),
        (a, b) => {
          const aSnapshot = structuredClone(a);
          const bSnapshot = structuredClone(b);
          const merged = mergeUniqueEvents(a, b);

          const seen = new Set<string>();
          const expected: unknown[] = [];
          for (const event of [...a, ...b]) {
            const key = JSON.stringify(event);
            if (!seen.has(key)) {
              seen.add(key);
              expected.push(event);
            }
          }

          expect(merged).toEqual(expected);
          expect(
            new Set(merged.map((event) => JSON.stringify(event))).size,
          ).toBe(merged.length);
          expect(a).toEqual(aSnapshot);
          expect(b).toEqual(bSnapshot);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("resolveSchemaForEvent is side-effect free and returns only matching schema URLs", () => {
    const eventSchemaArbitrary = fc.array(
      fc.record({
        eventName: fc.string({ maxLength: 32 }),
        schemaUrl: urlArbitrary,
        description: fc.option(fc.string({ maxLength: 64 }), {
          nil: undefined,
        }),
        canonicalUrl: fc.option(urlArbitrary, { nil: undefined }),
      }),
      { maxLength: 5 },
    );

    fc.assert(
      fc.property(
        eventArbitrary,
        eventSchemaArbitrary,
        urlArbitrary,
        (event, schemas, entryUrl) => {
          const eventSnapshot = structuredClone(event);
          const schemasSnapshot = structuredClone(schemas);
          const result = resolveSchemaForEvent(
            event,
            schemas as EventSchema[],
            entryUrl,
          );

          const expectedUrl =
            event !== null &&
            typeof event === "object" &&
            typeof (event as Record<string, unknown>)["event"] === "string"
              ? (schemas.find(
                  (schema) =>
                    schema.eventName ===
                    (event as Record<string, unknown>)["event"],
                )?.schemaUrl ?? entryUrl)
              : entryUrl;

          expect(result.schemaUrl).toBe(expectedUrl);
          expect(event).toEqual(eventSnapshot);
          expect(schemas).toEqual(schemasSnapshot);
        },
      ),
      { numRuns: 20 },
    );
  }, 5_000);
});
