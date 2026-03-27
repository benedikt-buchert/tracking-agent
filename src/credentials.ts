import { readFile } from "fs/promises";

export interface CredentialField {
  description: string;
  value: string;
}

export interface CredentialStore {
  get(name: string): string | undefined;
  fieldSummary(): { name: string; description: string }[];
}

type ReadFileFn = (path: string) => Promise<string>;

const defaultReadFile: ReadFileFn = (path) => readFile(path, "utf8");

export async function loadCredentials(
  path: string,
  readFileFn: ReadFileFn = defaultReadFile,
): Promise<CredentialStore> {
  let raw: string;
  try {
    raw = await readFileFn(path);
  } catch (err) {
    throw new Error(`Cannot read credentials file: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in credentials file: ${path}`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("fields" in parsed) ||
    typeof (parsed as Record<string, unknown>)["fields"] !== "object" ||
    (parsed as Record<string, unknown>)["fields"] === null
  ) {
    throw new Error(
      `Credentials file must contain a "fields" object: ${path}`,
    );
  }

  const fields = (parsed as { fields: Record<string, unknown> }).fields;
  const entries = Object.entries(fields);

  if (entries.length === 0) {
    throw new Error(`Credentials file has empty "fields" object: ${path}`);
  }

  const store = new Map<string, CredentialField>();

  for (const [name, field] of entries) {
    if (typeof field !== "object" || field === null) {
      throw new Error(
        `Credential field "${name}" must be an object with "description" and "value"`,
      );
    }
    const f = field as Record<string, unknown>;
    if (typeof f["description"] !== "string") {
      throw new Error(
        `Credential field "${name}" must have a string "description"`,
      );
    }
    if (typeof f["value"] !== "string") {
      throw new Error(
        `Credential field "${name}" must have a string "value"`,
      );
    }
    store.set(name, {
      description: f["description"],
      value: f["value"],
    });
  }

  return {
    get(name: string): string | undefined {
      return store.get(name)?.value;
    },
    fieldSummary(): { name: string; description: string }[] {
      return [...store.entries()].map(([name, field]) => ({
        name,
        description: field.description,
      }));
    },
  };
}

export function formatCredentialsSummary(
  fields: { name: string; description: string }[],
): string {
  if (fields.length === 0) return "";
  const lines = [
    "## Available credential fields",
    "",
    "You have access to pre-loaded credential values for the following fields.",
    "Use the `fill_credential` tool to fill these into form elements. Never ask",
    "the user for these values — they are already provided.",
    "",
  ];
  for (const f of fields) {
    lines.push(`- ${f.name} — ${f.description}`);
  }
  return lines.join("\n");
}
