// Task state, check runs and the Stop-hook gate. A check counts only if it ran
// (or was recorded) after the current task started: evidence from this task.
// Tasks are anchored to a position in checks.jsonl, not a timestamp, so a
// result written in the same millisecond as the start can't leak in.

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Table } from "./defaults";

export const TIERS = ["trivial", "standard", "complex", "critical"] as const;
export const PLAYBOOKS = ["foundation", "design", "feature", "integration", "debug", "spike", "hardening", "audit"] as const;

export interface Task {
  tier: string;
  playbook: string;
  started: string;
  // Lines already in checks.jsonl when the task started; only later lines count.
  from: number;
}

export interface CheckResult {
  name: string;
  status: "pass" | "fail";
  how: "ran" | "recorded";
  at: string;
  note?: string;
}

export type Label = "Verified" | "Partially verified" | "Not verified" | "Blocked";

const dir = (cwd: string): string => join(cwd, ".saw");

export function startTask(cwd: string, tier: string, playbook: string): Task {
  if (!(TIERS as readonly string[]).includes(tier)) throw new Error(`tier must be one of ${TIERS.join(" | ")}`);
  if (!(PLAYBOOKS as readonly string[]).includes(playbook)) throw new Error(`playbook must be one of ${PLAYBOOKS.join(" | ")}`);
  const task: Task = { tier, playbook, started: new Date().toISOString(), from: checkLines(cwd).length };
  mkdirSync(dir(cwd), { recursive: true });
  writeFileSync(join(dir(cwd), "task.json"), JSON.stringify(task, null, 2) + "\n");
  return task;
}

export function currentTask(cwd: string): Task | undefined {
  const path = join(dir(cwd), "task.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Task) : undefined;
}

export function endTask(cwd: string): void {
  rmSync(join(dir(cwd), "task.json"), { force: true });
}

export function recordCheck(cwd: string, result: Omit<CheckResult, "at">): void {
  mkdirSync(dir(cwd), { recursive: true });
  appendFileSync(join(dir(cwd), "checks.jsonl"), JSON.stringify({ ...result, at: new Date().toISOString() }) + "\n");
}

// Latest result per check since the task started.
export function checksSince(cwd: string, from: number): Map<string, CheckResult> {
  const latest = new Map<string, CheckResult>();
  for (const line of checkLines(cwd).slice(from)) {
    const r = JSON.parse(line) as CheckResult;
    latest.set(r.name, r);
  }
  return latest;
}

function checkLines(cwd: string): string[] {
  const path = join(dir(cwd), "checks.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((line) => line.trim());
}

// verify.<tier>.run, following `extends`.
export function requiredChecks(config: Table, tier: string, seen = new Set<string>()): string[] {
  const verify = (config.verify ?? {}) as Record<string, { run?: string[]; extends?: string }>;
  const entry = verify[tier];
  if (!entry || seen.has(tier)) return [];
  seen.add(tier);
  const parent = entry.extends ? requiredChecks(config, entry.extends, seen) : [];
  return [...new Set([...parent, ...(entry.run ?? [])])];
}

export interface Status {
  label: Label;
  passed: string[];
  failed: string[];
  missing: string[];
}

export function taskStatus(cwd: string, config: Table, task: Task): Status {
  const results = checksSince(cwd, task.from);
  const status: Status = { label: "Verified", passed: [], failed: [], missing: [] };
  for (const name of requiredChecks(config, task.tier)) {
    const r = results.get(name);
    if (!r) status.missing.push(name);
    else if (r.status === "pass") status.passed.push(name);
    else status.failed.push(name);
  }
  if (status.failed.length) status.label = "Blocked";
  else if (status.missing.length) status.label = status.passed.length ? "Partially verified" : "Not verified";
  return status;
}

// Stop hook: returns the JSON to print, or undefined to allow the stop.
export function gate(cwd: string, config: Table, hookInput: { stop_hook_active?: boolean }): { decision: "block"; reason: string } | undefined {
  const features = (config.features ?? {}) as Record<string, boolean>;
  if (!features.verify_hook || hookInput.stop_hook_active) return undefined;
  const task = currentTask(cwd);
  if (!task) return undefined;
  const s = taskStatus(cwd, config, task);
  if (s.label === "Verified") return undefined;
  const parts = [
    s.failed.length ? `failed: ${s.failed.join(", ")}` : "",
    s.missing.length ? `not run: ${s.missing.join(", ")}` : "",
  ].filter(Boolean);
  return {
    decision: "block",
    reason: `${task.tier} task is ${s.label} (${parts.join("; ")}). Run each with \`saw run <check>\`, or \`saw task record <check> pass|fail --note "..."\` for reviews. If a check can't run here, report it as Not verified and run \`saw task end\`.`,
  };
}
