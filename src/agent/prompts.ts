import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import type { EventSchema } from "../schema.js";

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../prompts");

export function readPrompt(name: string): string {
  return readFileSync(join(PROMPTS_DIR, name), "utf8").trim();
}

export function createSystemPrompt(): string {
  return readPrompt("system.md");
}

export function buildInitialPrompt(
  schemaUrl: string,
  targetUrl: string,
  eventSchemas: EventSchema[],
): string {
  const schemasText = eventSchemas
    .map(
      (s) =>
        `- ${s.eventName}${s.description ? ` — ${s.description}` : ""}\n  Schema: ${s.schemaUrl}`,
    )
    .join("\n");
  return readPrompt("initial.md")
    .replace("{{schemaUrl}}", schemaUrl)
    .replace("{{targetUrl}}", targetUrl)
    .replace("{{eventSchemas}}", schemasText);
}
