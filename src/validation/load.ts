import { readFile } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";

type ReadFileFn = (path: string, encoding: "utf8") => Promise<string>;
export type LoadSchemaFn = (uri: string) => Promise<Record<string, unknown>>;

export async function defaultLoadSchema(
  uri: string,
  fetchFn: typeof fetch = fetch,
  readFileFn: ReadFileFn = readFile,
): Promise<Record<string, unknown>> {
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    const res = await fetchFn(uri);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${uri}`);
    return res.json() as Promise<Record<string, unknown>>;
  }

  const filePath = uri.startsWith("file://") ? fileURLToPath(uri) : uri;
  const content = await readFileFn(filePath, "utf8");
  return JSON.parse(content) as Record<string, unknown>;
}

/**
 * Returns a LoadSchemaFn that resolves HTTP URLs containing a `schemas/` path
 * segment to local files under `schemasDir` first, falling back to HTTP fetch
 * when the local file is absent. Non-HTTP URIs are handled by defaultLoadSchema.
 */
export function createLocalFirstLoader(
  schemasDir: string,
  fetchFn: typeof fetch = fetch,
  readFileFn: ReadFileFn = readFile,
): LoadSchemaFn {
  return async (uri: string): Promise<Record<string, unknown>> => {
    if (uri.startsWith("http://") || uri.startsWith("https://")) {
      const url = new URL(uri);
      const schemaSegment = url.pathname.includes("schemas/")
        ? url.pathname.slice(url.pathname.indexOf("schemas/"))
        : null;

      if (schemaSegment) {
        const localPath = join(schemasDir, schemaSegment);
        try {
          const content = await readFileFn(localPath, "utf8");
          return JSON.parse(content) as Record<string, unknown>;
        } catch {
          // fall through to HTTP
        }
      }

      return defaultLoadSchema(uri, fetchFn, readFileFn);
    }

    return defaultLoadSchema(uri, fetchFn, readFileFn);
  };
}
