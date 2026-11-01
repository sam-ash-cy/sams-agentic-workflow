// Task metrics: one line per finished task in .saw/metrics.jsonl, written by
// `saw task end`. Token counts come from --tokens, or best-effort from the
// session transcript the Stop hook saw (Claude Code only).

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Table } from "./defaults";
import { readReviews } from "./review-session";
import { checkResults, taskStatus, type Label, type Task } from "./task";

export interface TaskMetric {
  at: string;
  tier: string;
  playbook: string;
  label: Label;
  first_pass: boolean;
  rework: number;
  findings: Record<string, number>;
  duration_s: number;
  tokens?: number;
  tokens_source?: "flag" | "transcript";
}

// Sums usage on transcript entries at or after `since`. The transcript format
// isn't a documented API, so anything unexpected yields undefined.
export function transcriptTokens(path: string, since: string): number | undefined {
  if (!existsSync(path)) return undefined;
  let total = 0;
  let seen = false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { timestamp?: string; message?: { usage?: Record<string, unknown> } };
      const usage = entry.message?.usage;
      if (!usage || !entry.timestamp || entry.timestamp < since) continue;
      for (const key of ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]) {
        if (typeof usage[key] === "number") total += usage[key] as number;
      }
      seen = true;
    } catch {
      // A partial last line while the session is still writing: skip it.
    }
  }
  return seen ? total : undefined;
}

export function buildMetric(cwd: string, config: Table, task: Task, tokens?: number, now = new Date()): TaskMetric {
  const status = taskStatus(cwd, config, task);
  const results = checkResults(cwd, task.from);
  const fails = results.filter((r) => r.status === "fail");
  const findings: Record<string, number> = {};
  for (const r of fails) findings[r.name] = (findings[r.name] ?? 0) + 1;
  // Findings from [review_session] sub-sessions recorded during this task.
  const reviewed = readReviews(cwd).filter((r) => r.at >= task.started).reduce((n, r) => n + r.findings, 0);
  if (reviewed) findings.review_session = reviewed;

  const metric: TaskMetric = {
    at: now.toISOString(),
    tier: task.tier,
    playbook: task.playbook,
    label: status.label,
    first_pass: status.label === "Verified" && fails.length === 0,
    rework: fails.length,
    findings,
    duration_s: Math.max(0, Math.round((now.getTime() - Date.parse(task.started)) / 1000)),
  };
  if (tokens !== undefined) {
    metric.tokens = tokens;
    metric.tokens_source = "flag";
  } else if (task.transcript) {
    const t = transcriptTokens(task.transcript, task.started);
    if (t !== undefined) {
      metric.tokens = t;
      metric.tokens_source = "transcript";
    }
  }
  return metric;
}

export function appendMetric(cwd: string, metric: TaskMetric): void {
  mkdirSync(join(cwd, ".saw"), { recursive: true });
  appendFileSync(join(cwd, ".saw", "metrics.jsonl"), JSON.stringify(metric) + "\n");
}

export function readMetrics(cwd: string): TaskMetric[] {
  const path = join(cwd, ".saw", "metrics.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as TaskMetric];
      } catch {
        return [];
      }
    });
}
