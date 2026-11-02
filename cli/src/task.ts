// Task state, check runs and the Stop-hook gate. A check counts only if it ran
// (or was recorded) after the current task started: evidence from this task.
// Tasks are anchored to a position in checks.jsonl, not a timestamp, so a
// result written in the same millisecond as the start can't leak in.

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Table } from "./defaults";
import { reviewBudget, type ReviewSettings } from "./review-session";

export const TIERS = ["trivial", "standard", "complex", "critical"] as const;
export const PHASES = ["plan", "implement", "review"] as const;
export const PLAYBOOKS = ["foundation", "design", "feature", "integration", "debug", "spike", "hardening", "audit"] as const;

export interface Task {
  tier: string;
  playbook: string;
  started: string;
  // Lines already in checks.jsonl when the task started; only later lines count.
  from: number;
  // Session transcript, saved by the Stop hook, for the token tally at task end.
  transcript?: string;
  // Per-task style override ("this task: tone=verbose"), set by saw task start.
  style?: { tone?: string; max_words?: number };
  // Where the task is (saw task phase): implement makes the implementer edit guard deny.
  phase?: (typeof PHASES)[number];
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

export function startTask(cwd: string, tier: string, playbook: string, style?: Task["style"]): Task {
  if (!(TIERS as readonly string[]).includes(tier)) throw new Error(`tier must be one of ${TIERS.join(" | ")}`);
  if (!(PLAYBOOKS as readonly string[]).includes(playbook)) throw new Error(`playbook must be one of ${PLAYBOOKS.join(" | ")}`);
  const task: Task = { tier, playbook, started: new Date().toISOString(), from: checkLines(cwd).length };
  if (style && (style.tone || style.max_words)) task.style = style;
  mkdirSync(dir(cwd), { recursive: true });
  writeFileSync(join(dir(cwd), "task.json"), JSON.stringify(task, null, 2) + "\n");
  rmSync(join(dir(cwd), "untasked-edits"), { force: true });
  return task;
}

// A saw project: one with workflow.toml. The plugin's hooks run in every repo,
// so routing is only enforced where the workflow was set up.
export const isSawProject = (cwd: string): boolean => existsSync(join(cwd, "workflow.toml"));

// Post-edit hook: remembers that files changed while no task was open.
// An edit in another repo (or ~/.claude) isn't this project's work: that repo's
// own task, if any, covers it, so it doesn't arm this project's Stop gate.
export function markUntaskedEdit(cwd: string, filePath?: string): void {
  if (!isSawProject(cwd) || currentTask(cwd)) return;
  if (filePath) {
    const rel = relative(cwd, resolve(cwd, filePath));
    if (rel.startsWith("..") || isAbsolute(rel)) return;
  }
  mkdirSync(dir(cwd), { recursive: true });
  writeFileSync(join(dir(cwd), "untasked-edits"), new Date().toISOString() + "\n");
}

export function currentTask(cwd: string): Task | undefined {
  const path = join(dir(cwd), "task.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Task) : undefined;
}

export function setPhase(cwd: string, phase: string): Task {
  if (!(PHASES as readonly string[]).includes(phase)) throw new Error(`phase must be one of ${PHASES.join(" | ")}`);
  const task = currentTask(cwd);
  if (!task) throw new Error("no open task; start one with saw task start --tier <t> --playbook <p>");
  task.phase = phase as Task["phase"];
  writeFileSync(join(dir(cwd), "task.json"), JSON.stringify(task, null, 2) + "\n");
  return task;
}

export function endTask(cwd: string): void {
  rmSync(join(dir(cwd), "task.json"), { force: true });
}

export function recordCheck(cwd: string, result: Omit<CheckResult, "at">): void {
  mkdirSync(dir(cwd), { recursive: true });
  appendFileSync(join(dir(cwd), "checks.jsonl"), JSON.stringify({ ...result, at: new Date().toISOString() }) + "\n");
}

// Every result since the task started, oldest first.
export function checkResults(cwd: string, from: number): CheckResult[] {
  const lines = checkLines(cwd);
  // The log was truncated or deleted mid-task: everything in it is new.
  return lines.slice(from > lines.length ? 0 : from).map((line) => JSON.parse(line) as CheckResult);
}

// Latest result per check since the task started.
export function checksSince(cwd: string, from: number): Map<string, CheckResult> {
  return new Map(checkResults(cwd, from).map((r) => [r.name, r]));
}

export function saveTranscript(cwd: string, task: Task, transcript: string): void {
  if (task.transcript === transcript) return;
  writeFileSync(join(dir(cwd), "task.json"), JSON.stringify({ ...task, transcript }, null, 2) + "\n");
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
  // features.code_review / security_review / docs_step off: those checks aren't required.
  const features = (config.features ?? {}) as Record<string, boolean>;
  return [...new Set([...parent, ...(entry.run ?? [])])].filter((c) => !(c in REVIEW_FEATURES) || features[REVIEW_FEATURES[c]!] !== false);
}

const REVIEW_FEATURES: Record<string, string> = { code_review: "code_review", security_review: "security_review", docs: "docs_step" };

// Playbooks that ship something users read about; only these owe the docs check.
const DELIVERS = ["feature", "foundation"];

// The checks a task owes: its tier's, minus docs for playbooks that deliver nothing.
export const taskChecks = (config: Table, tier: string, playbook: string): string[] =>
  requiredChecks(config, tier).filter((c) => c !== "docs" || DELIVERS.includes(playbook));

// The tier for `saw task start`: --tier, else routing.default_tier unless it's "auto".
export function pickTier(config: Table, flag: string | undefined): string {
  if (flag) return flag;
  const d = ((config.routing ?? {}) as { default_tier?: string }).default_tier;
  if (d && d !== "auto") return d;
  throw new Error("--tier is required (routing.default_tier is auto)");
}

// Lifecycle steps `saw task start` prints for the agent, from [features] and [routing].
export function taskSteps(config: Table, tier: string, playbook = "feature"): string[] {
  const features = (config.features ?? {}) as Record<string, boolean>;
  const grill = ((config.routing ?? {}) as { always_grill?: string[] }).always_grill ?? [];
  const steps: string[] = [];
  if (features.grilling && grill.includes(tier)) steps.push("grilling first");
  if (features.trail) steps.push("trail ask/skeleton before reading code");
  if (features.tdd && tier !== "trivial") steps.push("tdd (failing test first)");
  const big = tier === "complex" || tier === "critical";
  if (features.worktrees && big) steps.push("one worktree per task");
  if (features.parallel_sessions && big) steps.push("split independent steps into sessions (autonomy.actions.spawn_sessions)");
  if (features.implementer && tier !== "trivial") steps.push("after the plan: run `saw task phase implement` and hand each unit to the implementer agent (models.roles.implement), then `saw task phase review` and review its diff here");
  if (features.unslop && playbook === "design") steps.push("unslop polish pass before screenshots");
  const delivers = DELIVERS.includes(playbook);
  if (features.docs_step && delivers) steps.push("docs step: engineering:documentation in the Diataxis split (tutorial, how-to, reference, explanation); mattpocock-skills:writing-for-agents for AGENTS.md, CLAUDE.md and skill files" +
    (taskChecks(config, tier, playbook).includes("docs") ? "; then saw task record docs pass --note \"<files>\" (or --note \"none needed: <why>\")" : ""));
  if (features.ecc && delivers) steps.push("before the PR: ecc:verification-loop (build, types, lint, tests, diff review)");
  if (features.brag && delivers) steps.push("optional after the PR merges: a launch video with the brag skill");
  const checks = taskChecks(config, tier, playbook);
  steps.push(checks.length ? `checks: ${checks.join(", ")}` : "checks: none");
  const audit = (config.audit ?? {}) as { auditors?: string[]; triggers?: string[]; token_budget?: number };
  const triggered = (audit.triggers ?? []).some((t) => t === tier || t === playbook);
  if (features.audit && triggered && audit.auditors?.length) {
    steps.push(`audit: ${audit.auditors.join(", ")} (≤${audit.token_budget} tokens each; findings in one list)`);
  }
  const review = (config.review_session ?? {}) as ReviewSettings;
  if (review.enabled && reviewBudget(config, tier) > 0 && review.when?.length) {
    steps.push(`review session for a ${review.when.join("/")} unit before the PR: saw review-session run (${review.mode}, ≤${reviewBudget(config, tier)} tokens); fix or answer each finding`);
  }
  return steps;
}

// Checks judged by the agent and recorded with `saw task record`; every other
// check needs a command in [checks] and only counts when `saw run` ran it.
export const JUDGEMENT_CHECKS = ["code_review", "security_review", "threat_model", "rollback_plan", "docs"];

export interface Status {
  label: Label;
  passed: string[];
  failed: string[];
  missing: string[];
  // Required mechanical checks with no command configured: reported, not blocking.
  unconfigured: string[];
}

export function taskStatus(cwd: string, config: Table, task: Task): Status {
  const results = checksSince(cwd, task.from);
  const commands = (config.checks ?? {}) as Record<string, string>;
  const status: Status = { label: "Verified", passed: [], failed: [], missing: [], unconfigured: [] };
  for (const name of taskChecks(config, task.tier, task.playbook)) {
    const mechanical = !JUDGEMENT_CHECKS.includes(name);
    if (mechanical && !commands[name]) {
      status.unconfigured.push(name);
      continue;
    }
    const r = results.get(name);
    if (!r || (mechanical && r.how !== "ran")) status.missing.push(name);
    else if (r.status === "pass") status.passed.push(name);
    else status.failed.push(name);
  }
  if (status.failed.length) status.label = "Blocked";
  else if (status.missing.length) status.label = status.passed.length ? "Partially verified" : "Not verified";
  return status;
}

// `saw task report`: the verification section of a PR description.
export function taskReport(cwd: string, config: Table, task: Task): string {
  const s = taskStatus(cwd, config, task);
  const notes = new Map([...checksSince(cwd, task.from)].map(([name, r]) => [name, r.note]));
  const line = (name: string, label: string): string => `- ${label}: \`${name}\`${notes.get(name) ? ` (${notes.get(name)})` : ""}`;
  return [
    `**Verification: ${s.label}** (${task.tier} / ${task.playbook})`,
    "",
    ...s.passed.map((n) => line(n, "Verified")),
    ...s.failed.map((n) => line(n, "Failed")),
    ...s.missing.map((n) => line(n, "Not verified")),
    ...s.unconfigured.map((n) => `- Not verified: \`${n}\` (no command configured)`),
  ].join("\n");
}

// Stop hook: returns the JSON to print, or undefined to allow the stop.
export function gate(
  cwd: string,
  config: Table,
  hookInput: { stop_hook_active?: boolean; transcript_path?: string },
): { decision: "block"; reason: string } | undefined {
  const task = currentTask(cwd);
  if (task && typeof hookInput.transcript_path === "string") saveTranscript(cwd, task, hookInput.transcript_path);
  const features = (config.features ?? {}) as Record<string, boolean>;
  if (!features.verify_hook || hookInput.stop_hook_active) return undefined;
  if (!task) {
    // Files changed but routing never ran, so there is nothing to verify against.
    const marker = join(dir(cwd), "untasked-edits");
    if (!existsSync(marker)) return undefined;
    // Block once per batch of edits; the next edit sets the marker again.
    rmSync(marker, { force: true });
    return {
      decision: "block",
      reason: "Files were edited but no saw task is open, so nothing was verified. Use the router skill to classify the work, run `saw task start --tier <t> --playbook <p>` (or `saw task adhoc` for a one-off edit), then run its checks.",
    };
  }
  const s = taskStatus(cwd, config, task);
  if (s.label === "Verified") return undefined;
  const parts = [
    s.failed.length ? `failed: ${s.failed.join(", ")}` : "",
    s.missing.length ? `not run: ${s.missing.join(", ")}` : "",
  ].filter(Boolean);
  // Debugging is phased in when needed: a check failing twice means guessing has stopped working.
  const repeated = repeatedFailures(cwd, task);
  const debug = repeated.length && task.playbook !== "debug"
    ? ` ${repeated.join(", ")} failed more than once: switch to the debug playbook (reproduce, hypothesise, then fix) before another attempt.`
    : "";
  return {
    decision: "block",
    reason: `${task.tier} task is ${s.label} (${parts.join("; ")}).${debug} Run each with \`saw run <check>\`, or \`saw task record <check> pass|fail --note "..."\` for reviews. If a check can't run here, report it as Not verified and run \`saw task end\`.`,
  };
}

export function repeatedFailures(cwd: string, task: Task): string[] {
  const counts = new Map<string, number>();
  const latest = checksSince(cwd, task.from);
  for (const r of checkResults(cwd, task.from)) if (r.status === "fail") counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  // Only checks still failing: one that has since passed needs no debugging.
  return [...counts].filter(([name, n]) => n >= 2 && latest.get(name)?.status === "fail").map(([name]) => name);
}
