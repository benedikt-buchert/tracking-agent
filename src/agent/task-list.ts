import type { EventSchema } from "../schema.js";

export type TaskStatus = "pending" | "found" | "skipped";

export interface EventTask {
  eventName: string;
  description?: string;
  status: TaskStatus;
  skipReason?: string;
}

export interface TaskList {
  readonly tasks: EventTask[];
  readonly foundCount: number;
  readonly totalCount: number;
  update(events: unknown[]): void;
  skip(eventName: string, reason: string): void;
  format(): string;
  formatCompact(): string;
}

export function createTaskList(eventSchemas: EventSchema[]): TaskList {
  const tasks: EventTask[] = eventSchemas.map((s) => ({
    eventName: s.eventName,
    description: s.description,
    status: "pending" as TaskStatus,
  }));

  return {
    get tasks() {
      return tasks;
    },
    get foundCount() {
      return tasks.filter((t) => t.status === "found").length;
    },
    get totalCount() {
      return tasks.length;
    },

    update(events: unknown[]) {
      for (const event of events) {
        if (event === null || typeof event !== "object") continue;
        const name = (event as Record<string, unknown>)["event"];
        if (typeof name !== "string") continue;
        const task = tasks.find((t) => t.eventName === name);
        if (task) task.status = "found";
      }
    },

    skip(eventName: string, reason: string) {
      const task = tasks.find((t) => t.eventName === eventName);
      if (task && task.status === "pending") {
        task.status = "skipped";
        task.skipReason = reason;
      }
    },

    format() {
      const pending = tasks.filter((t) => t.status === "pending");
      const skipped = tasks.filter((t) => t.status === "skipped");
      const found = tasks.filter((t) => t.status === "found");
      const skipCount = skipped.length > 0 ? ` (${skipped.length} skipped)` : "";
      const lines = [
        `## Task progress: ${this.foundCount}/${this.totalCount} events found${skipCount}`,
      ];
      if (pending.length > 0) {
        lines.push("", "Still needed:");
        for (const t of pending) lines.push(`  ✗ ${t.eventName}${t.description ? ` — ${t.description}` : ""}`);
      }
      if (skipped.length > 0) {
        lines.push("", "Skipped (could not trigger):");
        for (const t of skipped) lines.push(`  ~ ${t.eventName}${t.skipReason ? ` — ${t.skipReason}` : ""}`);
      }
      if (found.length > 0) {
        lines.push("", "Already found:");
        for (const t of found) lines.push(`  ✓ ${t.eventName}`);
      }
      return lines.join("\n");
    },

    formatCompact() {
      const pending = tasks.filter((t) => t.status === "pending");
      const skipped = tasks.filter((t) => t.status === "skipped");
      const found = tasks.filter((t) => t.status === "found");
      const parts = [
        `${this.foundCount}/${this.totalCount}`,
        ...pending.map((t) => `✗ ${t.eventName}`),
        ...skipped.map((t) => `~ ${t.eventName}`),
        ...found.map((t) => `✓ ${t.eventName}`),
      ];
      return parts.join("  ");
    },
  };
}
