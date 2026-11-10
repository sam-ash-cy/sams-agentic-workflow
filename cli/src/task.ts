// Task state, check runs and the Stop-hook gate. A check counts only if it ran
// (or was recorded) after the current task started: evidence from this task.
// Tasks are anchored to a position in checks.jsonl, not a timestamp, so a
// result written in the same millisecond as the start can't leak in.

import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Table } from "./defaults";
import { branchSettings } from "./branch";
import { readReviews, reportVerdict, reviewBudget, signatureValid, type ReviewSettings } from "./review-session";

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
  // The review report that backs a recorded review (verify.require_review_evidence).
  report?: string;
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
// Playbooks that may change the public surface without shipping a feature.
const SURFACE_PLAYBOOKS = ["debug", "integration", "hardening"];

// The checks a task owes: its tier's, minus docs for playbooks that deliver nothing.
export const taskChecks = (config: Table, tier: string, playbook: string): string[] => [
  ...requiredChecks(config, tier).filter((c) => c !== "docs" || DELIVERS.includes(playbook)),
  ...prePrSkills(config, tier).map((s) => `skill:${s}`),
];

// [pre_pr] skills: skills that must run (and be recorded) before the PR on these tiers.
export function prePrSkills(config: Table, tier: string): string[] {
  const pre = (config.pre_pr ?? {}) as { skills?: string[]; tiers?: string[] };
  return (pre.tiers ?? []).includes(tier) ? (pre.skills ?? []).filter((s) => /^[\w:./-]+$/.test(s)) : [];
}

// The tier for `saw task start`: --tier, else routing.default_tier unless it's "auto".
export function pickTier(config: Table, flag: string | undefined): string {
  if (flag) return flag;
  const d = ((config.routing ?? {}) as { default_tier?: string }).default_tier;
  if (d && d !== "auto") return d;
  throw new Error("--tier is required (routing.default_tier is auto)");
}

// [tdd] mode hard: saw guard holds code edits until a test run fails (tests-first.ts).
export function tddSettings(config: Table): { hard: boolean; playbooks: string[] } {
  const on = ((config.features ?? {}) as Record<string, boolean>).tdd;
  const t = (config.tdd ?? {}) as { mode?: string; playbooks?: string[] };
  return { hard: !!on && t.mode === "hard", playbooks: t.playbooks ?? [] };
}

// Lifecycle steps `saw task start` prints for the agent, from [features] and [routing].
// [task_skills]: the playbook's skills, plus "plan" for complex and critical tasks.
export function taskSkills(config: Table, tier: string, playbook: string): string[] {
  const map = (config.task_skills ?? {}) as Record<string, string[]>;
  const plan = tier === "complex" || tier === "critical" ? map.plan ?? [] : [];
  return [...new Set([...plan, ...(map[playbook] ?? [])])];
}

export function taskSteps(config: Table, tier: string, playbook = "feature"): string[] {
  const features = (config.features ?? {}) as Record<string, boolean>;
  const grill = ((config.routing ?? {}) as { always_grill?: string[] }).always_grill ?? [];
  const steps: string[] = [];
  if (features.grilling && grill.includes(tier)) steps.push("grilling first");
  if (features.trail) steps.push("trail ask/skeleton before reading code");
  if (features.tdd && tier !== "trivial") {
    const tdd = tddSettings(config);
    const enforced = tdd.hard && tdd.playbooks.includes(playbook) && !!((config.checks ?? {}) as Record<string, unknown>).test;
    steps.push(enforced ? "tests first: write the failing tests from the plan, run `saw run test` and see it fail, then write the code (saw guard holds code edits until then)" : "tdd (failing test first)");
  }
  const big = tier === "complex" || tier === "critical";
  if (features.branch_guard && tier !== "trivial") steps.push(`own branch off ${branchSettings(config).base} (saw task start --branch <type>/<kebab>)`);
  if (features.worktrees && big) steps.push("one worktree per task");
  if (features.parallel_sessions && big) steps.push("split independent steps into sessions (autonomy.actions.spawn_sessions)");
  if (features.implementer && tier !== "trivial") steps.push("after the plan: run `saw task phase implement` and hand each unit to the implementer agent (models.roles.implement), then `saw task phase review` and review its diff here");
  if (features.unslop && playbook === "design") steps.push("unslop polish pass before screenshots");
  const delivers = DELIVERS.includes(playbook);
  if (features.living_docs && !delivers && SURFACE_PLAYBOOKS.includes(playbook)) steps.push("living docs: if this changes commands, settings or APIs: update docs/reference/ (and glossary.md / conventions.md / learnings/ where they're affected)");
  if (features.docs_step && delivers) steps.push("docs step: engineering:documentation in the Diataxis split (tutorial, how-to, reference, explanation); mattpocock-skills:writing-for-agents for AGENTS.md, CLAUDE.md and skill files" +
    (taskChecks(config, tier, playbook).includes("docs") ? "; then saw task record docs pass --note \"<files>\" (or --note \"none needed: <why>\")" : ""));
  if (features.ecc && delivers) steps.push("before the PR: ecc:verification-loop (build, types, lint, tests, diff review)");
  if (features.brag && delivers) steps.push("optional after the PR merges: a launch video with the brag skill");
  if (features.task_skills && tier !== "trivial") {
    const fit = taskSkills(config, tier, playbook);
    if (fit.length) steps.push(`skills that fit (run each where it helps): ${fit.join(", ")}`);
  }
  for (const skill of prePrSkills(config, tier)) steps.push(`before the PR, required: run the ${skill} skill, then saw task record skill:${skill} pass --note "<result>"`);
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
    const mechanical = !JUDGEMENT_CHECKS.includes(name) && !name.startsWith("skill:");
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

export const EVIDENCE_CHECKS = ["code_review", "security_review"];

// verify.require_review_evidence: a passing review is recorded only with a
// review report from this task behind it. Returns the report to link, or the
// reason the record is refused. Recording a fail never needs evidence.
export function reviewEvidence(
  cwd: string,
  config: Table,
  task: Task,
  check: string,
  status: "pass" | "fail",
  reportFlag?: string,
): { report?: string; problem?: string } {
  const mode = ((config.verify ?? {}) as { require_review_evidence?: string }).require_review_evidence ?? "off";
  if (mode === "off" || status === "fail" || !EVIDENCE_CHECKS.includes(check)) return {};
  const rel = (p: string): string => relative(cwd, p).replaceAll("\\", "/");
  if (reportFlag !== undefined) {
    if (mode !== "agent") return { problem: `verify.require_review_evidence is review_session: only a saw review-session report counts, not --report` };
    const full = resolve(cwd, reportFlag);
    const r = relative(join(cwd, ".saw", "reviews"), full);
    if (!r || r.startsWith("..") || isAbsolute(r)) return { problem: `--report must be a file under .saw/reviews/ (got ${reportFlag})` };
    // One descriptor for the mtime check and the read, so the file can't be swapped between them.
    let fd: number;
    try {
      fd = openSync(full, "r");
    } catch {
      return { problem: `--report ${reportFlag} doesn't exist` };
    }
    let mtimeMs: number;
    let body: string;
    try {
      mtimeMs = fstatSync(fd).mtimeMs;
      body = readFileSync(fd, "utf8");
    } finally {
      closeSync(fd);
    }
    // 2s of slack: file systems store mtimes coarser than task.started's milliseconds.
    if (mtimeMs < Date.parse(task.started) - 2000) return { problem: `--report ${reportFlag} was written before this task started` };
    const verdict = reportVerdict(body);
    if (verdict !== "pass") return { problem: `--report ${reportFlag} ${verdict ? "has verdict: fail" : "has no verdict: line"}, so it can't back a pass` };
    return { report: rel(full) };
  }
  // The latest finished review session since the task started decides. Under
  // review_session only one saw spawned counts, proven by its signature: a
  // `review-session record`ed file, or a line written into reviews.jsonl by
  // hand, is as self-attested as --report.
  const latest = readReviews(cwd).filter((r) => r.at >= task.started && r.verdict && (mode === "agent" || (r.how === "ran" && signatureValid(cwd, r)))).pop();
  if (latest?.verdict === "pass") return { report: rel(resolve(cwd, latest.report)) };
  const how = mode === "agent"
    ? "run saw review-session run, or save the reviewer agent's report under .saw/reviews/ and pass it with --report <file>"
    : "run saw review-session run";
  return { problem: `verify.require_review_evidence is ${mode}: ${latest ? "the latest review session for this task has verdict: fail" : "no review report from this task backs this pass"}; ${how}` };
}

// `saw task report`: the verification section of a PR description.
export function taskReport(cwd: string, config: Table, task: Task): string {
  const s = taskStatus(cwd, config, task);
  const results = checksSince(cwd, task.from);
  const line = (name: string, label: string): string => {
    const r = results.get(name);
    const extra = [r?.note, r?.report ? `report: \`${r.report}\`` : ""].filter(Boolean).join("; ");
    return `- ${label}: \`${name}\`${extra ? ` (${extra})` : ""}`;
  };
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
