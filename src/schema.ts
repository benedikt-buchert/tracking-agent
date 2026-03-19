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
    refs.push(...extractRefList(obj[key]));
  }
  return refs;
}

function extractRefList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const refs: string[] = [];
  for (const item of value) {
    const ref = getStringProperty(item, "$ref");
    if (ref !== undefined) refs.push(ref);
  }
  return refs;
}

export function extractEventName(schema: unknown): string | undefined {
  if (schema === null || typeof schema !== "object") return undefined;
  const obj = schema as Record<string, unknown>;
  return extractEventNameFromProperties(obj) ?? getStringProperty(obj, "title");
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

function extractEventNameFromProperties(
  schema: Record<string, unknown>,
): string | undefined {
  const props = schema["properties"];
  if (props === null || typeof props !== "object") return undefined;

  const eventProp = (props as Record<string, unknown>)["event"];
  if (eventProp === null || typeof eventProp !== "object") return undefined;

  const eventObj = eventProp as Record<string, unknown>;
  return (
    getStringProperty(eventObj, "const") ?? getFirstString(eventObj["enum"])
  );
}

function getStringProperty(value: unknown, key: string): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : undefined;
}

function getFirstString(value: unknown): string | undefined {
  return Array.isArray(value) && typeof value[0] === "string"
    ? (value[0] as string)
    : undefined;
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
