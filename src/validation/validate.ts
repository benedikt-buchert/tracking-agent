import { compileValidator } from "./compile.js";
import type { ValidationResult } from "./compile.js";
import type { LoadSchemaFn } from "./load.js";

export type { ValidationResult };

const validatorCache = new Map<string, (data: unknown) => ValidationResult>();

export function clearValidatorCache(): void {
  validatorCache.clear();
}

export async function validateEvent(
  event: unknown,
  schemaUrl: string,
  loadSchemaFn: LoadSchemaFn,
): Promise<ValidationResult> {
  try {
    if (!validatorCache.has(schemaUrl)) {
      const schema = await loadSchemaFn(schemaUrl);
      const validate = await compileValidator(schema, loadSchemaFn);
      validatorCache.set(schemaUrl, validate);
    }
    return validatorCache.get(schemaUrl)!(event);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, errors: [msg] };
  }
}
