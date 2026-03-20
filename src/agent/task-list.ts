import type { EventSchema } from "../schema.js";

export type TaskStatus = "pending" | "found";

export interface EventTask {
  eventName: string;
  status: TaskStatus;
}

export interface TaskList {
  readonly tasks: EventTask[];
  readonly foundCount: number;
  readonly totalCount: number;
  update(events: unknown[]): void;
  format(): string;
  formatCompact(): string;
}

export function createTaskList(eventSchemas: EventSchema[]): TaskList {
  const tasks: EventTask[] = eventSchemas.map((s) => ({
    eventName: s.eventName,
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

    format() {
      const pending = tasks.filter((t) => t.status === "pending");
      const found = tasks.filter((t) => t.status === "found");
      const lines = [
        `## Task progress: ${this.foundCount}/${this.totalCount} events found`,
      ];
      if (pending.length > 0) {
        lines.push("", "Still needed:");
        for (const t of pending) lines.push(`  ✗ ${t.eventName}`);
      }
      if (found.length > 0) {
        lines.push("", "Already found:");
        for (const t of found) lines.push(`  ✓ ${t.eventName}`);
      }
      return lines.join("\n");
    },

    formatCompact() {
      const pending = tasks.filter((t) => t.status === "pending");
      const found = tasks.filter((t) => t.status === "found");
      const parts = [
        `${this.foundCount}/${this.totalCount}`,
        ...pending.map((t) => `✗ ${t.eventName}`),
        ...found.map((t) => `✓ ${t.eventName}`),
      ];
      return parts.join("  ");
    },
  };
}
