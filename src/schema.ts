export interface EventSchema {
  eventName: string;
  schemaUrl: string;
  description?: string;
  /** Canonical $schema URL declared inside the schema (properties.$schema.const), if any */
  canonicalUrl?: string;
}

export async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return res.json() as Promise<unknown>;
}

export function resolveRef(ref: string, baseUrl: string): string {
  return new URL(ref, baseUrl).href;
}

export function extractRefs(schema: unknown): string[] {
  if (schema === null || typeof schema !== "object") return [];
  const obj = schema as Record<string, unknown>;
  const refs: string[] = [];
  for (const key of ["oneOf", "anyOf", "allOf"] as const) {
    const arr = obj[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (item !== null && typeof item === "object") {
        const ref = (item as Record<string, unknown>)["$ref"];
        if (typeof ref === "string") {
          refs.push(ref);
        }
      }
    }
  }
  return refs;
}

export function extractEventName(schema: unknown): string | undefined {
  if (schema === null || typeof schema !== "object") return undefined;
  const obj = schema as Record<string, unknown>;

  // 1. properties.event.const
  const props = obj["properties"];
  if (props !== null && typeof props === "object") {
    const propsObj = props as Record<string, unknown>;
    const eventProp = propsObj["event"];
    if (eventProp !== null && typeof eventProp === "object") {
      const eventObj = eventProp as Record<string, unknown>;
      if (typeof eventObj["const"] === "string") {
        return eventObj["const"];
      }
      // 2. properties.event.enum[0]
      const enumVal = eventObj["enum"];
      if (Array.isArray(enumVal) && typeof enumVal[0] === "string") {
        return enumVal[0] as string;
      }
    }
  }

  // 3. title
  if (typeof obj["title"] === "string") {
    return obj["title"];
  }

  return undefined;
}

export function extractDescription(schema: unknown): string | undefined {
  if (schema === null || typeof schema !== "object") return undefined;
  const val = (schema as Record<string, unknown>)["description"];
  return typeof val === "string" ? val : undefined;
}

export function extractCanonicalUrl(schema: unknown): string | undefined {
  if (schema === null || typeof schema !== "object") return undefined;
  const props = (schema as Record<string, unknown>)["properties"];
  if (props === null || typeof props !== "object") return undefined;
  const schemaField = (props as Record<string, unknown>)["$schema"];
  if (schemaField === null || typeof schemaField !== "object") return undefined;
  const constVal = (schemaField as Record<string, unknown>)["const"];
  return typeof constVal === "string" ? constVal : undefined;
}

export function extractTrackingTargets(schema: unknown): string[] {
  if (schema === null || typeof schema !== "object") return [];
  const val = (schema as Record<string, unknown>)["x-tracking-targets"];
  if (!Array.isArray(val)) return [];
  return val.filter((t): t is string => typeof t === "string");
}

export async function discoverEventSchemas(
  entryUrl: string,
  trackingTarget?: string,
): Promise<EventSchema[]> {
  const entrySchema = await fetchJson(entryUrl);
  const rawRefs = extractRefs(entrySchema);

  const results: EventSchema[] = [];
  for (const ref of rawRefs) {
    const schemaUrl = resolveRef(ref, entryUrl);
    const subSchema = await fetchJson(schemaUrl);

    if (trackingTarget !== undefined) {
      const targets = extractTrackingTargets(subSchema);
      if (!targets.includes(trackingTarget)) continue;
    }

    const eventName = extractEventName(subSchema);
    if (eventName !== undefined) {
      const description = extractDescription(subSchema);
      const canonicalUrl = extractCanonicalUrl(subSchema);
      results.push({ eventName, schemaUrl, description, canonicalUrl });
    }
  }
  return results;
}
