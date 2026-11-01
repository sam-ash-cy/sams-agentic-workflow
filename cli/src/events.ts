// The unified workflow event log, .saw/events.jsonl: one JSON line per event
// (tier pick, gate block/pass, guard deny/rewrite, budget warning, review
// session, saw run result). Gated by [logging]; .saw/logs/ keeps full check output.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Table } from "./defaults";

export type Level = "debug" | "info" | "warn";
const RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2 };

export interface WorkflowEvent {
  at: string;
  level: Level;
  kind: string;
  message: string;
  data?: Record<string, unknown>;
}

export const eventsPath = (cwd: string): string => join(cwd, ".saw", "events.jsonl");

// Never throws: a broken log must not break the hook that called it.
export function logEvent(cwd: string, config: Table, level: Level, kind: string, message: string, data?: Record<string, unknown>, now = new Date()): boolean {
  const logging = (config.logging ?? {}) as { enabled?: boolean; level?: Level };
  if (!logging.enabled || RANK[level] < RANK[logging.level ?? "info"]) return false;
  const event: WorkflowEvent = { at: now.toISOString(), level, kind, message, ...(data ? { data } : {}) };
  try {
    mkdirSync(join(cwd, ".saw"), { recursive: true });
    appendFileSync(eventsPath(cwd), JSON.stringify(event) + "\n");
    return true;
  } catch {
    return false;
  }
}

// The last `limit` well-formed events, oldest first.
export function readEvents(cwd: string, limit = Infinity): WorkflowEvent[] {
  const path = eventsPath(cwd);
  if (!existsSync(path)) return [];
  const events = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        const e = JSON.parse(l) as WorkflowEvent;
        return typeof e.kind === "string" && typeof e.at === "string" ? [e] : [];
      } catch {
        return [];
      }
    });
  return limit === Infinity ? events : events.slice(-limit);
}
