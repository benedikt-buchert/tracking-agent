import _Ajv from "ajv";
import _Ajv2020 from "ajv/dist/2020.js";
import _Ajv2019 from "ajv/dist/2019.js";
import _AjvDraft4 from "ajv-draft-04";
import _addFormats from "ajv-formats";
import _ajvKeywords from "ajv-keywords";
import type { LoadSchemaFn } from "./load.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Ajv = _Ajv as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Ajv2020 = _Ajv2020 as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Ajv2019 = _Ajv2019 as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AjvDraft4 = _AjvDraft4 as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const addFormats = _addFormats as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ajvKeywords = _ajvKeywords as any;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function extractAjvErrorFields(e: Record<string, unknown>): {
  instancePath: string;
  keyword: string;
  params: Record<string, unknown>;
  message: string;
} {
  return {
    instancePath:
      typeof e["instancePath"] === "string" ? e["instancePath"] : "",
    keyword: typeof e["keyword"] === "string" ? e["keyword"] : "",
    params:
      e["params"] !== null && typeof e["params"] === "object"
        ? (e["params"] as Record<string, unknown>)
        : {},
    message: typeof e["message"] === "string" ? e["message"] : "",
  };
}

function formatAjvKeywordError(
  keyword: string,
  params: Record<string, unknown>,
  prefix: string,
): string | undefined {
  if (keyword === "const") {
    const allowedValue = params["allowedValue"];
    if (allowedValue !== undefined) {
      return `${prefix}must equal ${JSON.stringify(allowedValue)}`;
    }
    return undefined;
  }

  if (keyword === "required") {
    const missingProperty = params["missingProperty"];
    return typeof missingProperty === "string"
      ? `Missing required property: ${missingProperty}`
      : undefined;
  }

  if (keyword === "additionalProperties") {
    const additionalProperty = params["additionalProperty"];
    return typeof additionalProperty === "string"
      ? `Unexpected property: ${additionalProperty}`
      : undefined;
  }

  return undefined;
}

export function formatAjvError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e === null || typeof e !== "object") return JSON.stringify(e);

  const { instancePath, keyword, params, message } = extractAjvErrorFields(
    e as Record<string, unknown>,
  );
  const prefix = instancePath ? `${instancePath} ` : "";
  return (
    formatAjvKeywordError(keyword, params, prefix) ??
    (message ? `${prefix}${message}` : JSON.stringify(e))
  );
}

export async function compileValidator(
  schema: Record<string, unknown>,
  loadSchemaFn?: LoadSchemaFn,
): Promise<(data: unknown) => ValidationResult> {
  const schemaVersion = schema["$schema"] as string | undefined;
  const loadSchema =
    loadSchemaFn ?? (() => Promise.reject(new Error("No loadSchemaFn provided")));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ajv: any;
  if (schemaVersion?.includes("2020-12")) {
    ajv = new Ajv2020({ allErrors: true, strict: false, loadSchema });
  } else if (schemaVersion?.includes("2019-09")) {
    ajv = new Ajv2019({ allErrors: true, strict: false, loadSchema });
  } else if (schemaVersion?.includes("draft-04")) {
    ajv = new AjvDraft4({ allErrors: true });
  } else {
    ajv = new Ajv({ allErrors: true, strict: false, loadSchema });
  }

  addFormats(ajv);
  if (typeof ajv.addKeyword === "function") ajv.addKeyword("x-gtm-clear");
  ajvKeywords(ajv);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let validate: any;
  if (schemaVersion?.includes("draft-04")) {
    validate = schema["$id"]
      ? (ajv.getSchema(String(schema["$id"])) ?? ajv.compile(schema))
      : ajv.compile(schema);
  } else {
    validate = await ajv.compileAsync(schema);
  }

  return (data: unknown): ValidationResult => {
    const valid = validate(data) as boolean;
    if (!valid) {
      return { valid: false, errors: ((validate.errors as unknown[]) ?? []).map(formatAjvError) };
    }
    return { valid: true, errors: [] };
  };
}
