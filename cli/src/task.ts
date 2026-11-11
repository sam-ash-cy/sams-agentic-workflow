// Task state, check runs and the Stop-hook gate. A check counts only if it ran
// (or was recorded) after the current task started: evidence from this task.
// Tasks are anchored to a position in checks.jsonl, not a timestamp, so a
// result written in the same millisecond as the start can't leak in.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Table } from "./defaults";
import { statePath as sessionFile } from "./session-state";
import { advisorModel } from "./skills";
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
  // HEAD when the task started: the tier floor measures the diff from here.
  base?: string;
  // Blob hashes of files already changed when the task started: the floor ignores them until they change again.
  baseDirty?: Record<string, string>;
  // The session that owns the task, stamped by a hook (see staleTask).
  session?: string;
  // Opened by routing.auto = "open" from the prompt alone: the agent confirms it with
  // saw task retier or saw task start before the verify guard lets a commit through.
  provisional?: boolean;
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
  const head = git(cwd, ["rev-parse", "HEAD"]);
  if (head) task.base = head;
  const dirty = head ? dirtyBaseline(cwd) : undefined;
  if (dirty) task.baseDirty = dirty;
  if (style && (style.tone || style.max_words)) task.style = style;
  mkdirSync(dir(cwd), { recursive: true });
  writeFileSync(join(dir(cwd), "task.json"), JSON.stringify(task, null, 2) + "\n");
  rmSync(join(dir(cwd), "untasked-edits"), { force: true });
  return task;
}

// routing.auto = "open": a task opened from the prompt alone, flagged provisional until
// the agent confirms it (saw task retier, or saw task start with its own choice).
// editedPath: the edit that opened it (the post-edit hook runs after the write), so that
// file counts as this task's work, not as dirty before it started.
export function openProvisional(cwd: string, tier: string, playbook: string, editedPath?: string): Task {
  const task: Task = { ...startTask(cwd, tier, playbook), provisional: true };
  if (editedPath && task.baseDirty) {
    const key = relative(repoTop(cwd) ?? cwd, resolve(cwd, editedPath)).split(sep).join("/");
    delete task.baseDirty[key];
    if (!Object.keys(task.baseDirty).length) delete task.baseDirty;
  }
  writeTask(cwd, task);
  return task;
}

// A saw project: one with workflow.toml. The plugin's hooks run in every repo,
// so routing is only enforced where the workflow was set up.
export const isSawProject = (cwd: string): boolean => existsSync(join(cwd, "workflow.toml"));

// Whether an edit to filePath, with no task open, belongs to this project (see markUntaskedEdit).
export function editOpensProvisional(cwd: string, filePath?: string): boolean {
  if (!isSawProject(cwd) || currentTask(cwd)) return false;
  if (!filePath) return true;
  const rel = relative(cwd, resolve(cwd, filePath));
  return !rel.startsWith("..") && !isAbsolute(rel);
}

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

// Puts a saved task back as the open one (saw resume).
// The resuming session adopts it: the next saw task hook stamps its session id.
export function restoreTask(cwd: string, task: Task): void {
  mkdirSync(dir(cwd), { recursive: true });
  const { session: _previous, ...rest } = task;
  writeFileSync(join(dir(cwd), "task.json"), JSON.stringify(rest, null, 2) + "\n");
}

const writeTask = (cwd: string, task: Task): void => writeFileSync(join(dir(cwd), "task.json"), JSON.stringify(task, null, 2) + "\n");

// Records which session owns the open task (from a hook: the CLI never sees the session id).
// An owned task keeps its owner unless `force` (saw resume adopting it).
export function setTaskSession(cwd: string, sessionId: string, force = false): void {
  const task = currentTask(cwd);
  if (!task || (task.session && !force) || task.session === sessionId) return;
  writeTask(cwd, { ...task, session: sessionId });
}

// An open task that another session started and nobody has resumed. A task with
// no recorded session (started outside a hook, or by an older saw) counts as current.
export function staleTask(cwd: string, sessionId: string | undefined): Task | undefined {
  const task = currentTask(cwd);
  return task?.session && sessionId && task.session !== sessionId ? task : undefined;
}

export const staleMessage = (task: Task): string =>
  `an open ${task.tier}/${task.playbook} task (started ${task.started.slice(0, 16).replace("T", " ")}) belongs to another session: run \`saw resume\` to pick it up, or \`saw task end --reason "<why>"\` to close it`;

export interface UnverifiedExit {
  label: string;
  reason: string;
  tier: string;
  playbook: string;
  at: string;
}

// `saw task end` on a task that isn't Verified leaves this for the next session-start to show once.
// A file, not an event: [logging] may be off.
const unverifiedPath = (cwd: string): string => join(dir(cwd), "unverified-exit.json");

export function noteUnverifiedExit(cwd: string, entry: UnverifiedExit): void {
  mkdirSync(dir(cwd), { recursive: true });
  writeFileSync(unverifiedPath(cwd), JSON.stringify(entry, null, 2) + "\n");
}

export function takeUnverifiedExit(cwd: string): UnverifiedExit | undefined {
  try {
    const entry = JSON.parse(readFileSync(unverifiedPath(cwd), "utf8")) as UnverifiedExit;
    rmSync(unverifiedPath(cwd), { force: true });
    return typeof entry?.label === "string" && typeof entry?.reason === "string" ? entry : undefined;
  } catch {
    return undefined;
  }
}

export function endTask(cwd: string): void {
  rmSync(join(dir(cwd), "task.json"), { force: true });
  // A closed task has nothing to resume.
  rmSync(join(dir(cwd), "handoff.json"), { force: true });
  rmSync(join(dir(cwd), "status.json"), { force: true });
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

const REVIEW_FEATURES: Record<string, string> = { code_review: "code_review", security_review: "security_review", docs: "docs_step", advisor: "advisor" };

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
  if (features.brag && delivers) steps.push("optional after the PR merges: a launch video with the brag skill");
  if (taskChecks(config, tier, playbook).includes("advisor")) {
    const model = advisorModel(config);
    steps.push(`advisor: after the plan and before reporting done, call the advisor tool (${model}); then saw task record advisor pass --note "<its advice, and what you did>"`);
  }
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
export const JUDGEMENT_CHECKS = ["code_review", "security_review", "threat_model", "rollback_plan", "docs", "advisor"];

export interface Status {
  label: Label;
  passed: string[];
  failed: string[];
  missing: string[];
  // Required mechanical checks with no command configured: Not verified ("not configured").
  unconfigured: string[];
  // Required mechanical checks with no command, waived by verify.allow_unconfigured.
  waived: string[];
  // Set when the task's tier is below the diff's floor: the task can't be Verified.
  floor?: string;
}

// verify.allow_unconfigured: checks that may have no command without blocking Verified.
const allowUnconfigured = (config: Table): string[] => {
  const v = ((config.verify ?? {}) as { allow_unconfigured?: unknown }).allow_unconfigured;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
};

export function taskStatus(cwd: string, config: Table, task: Task): Status {
  const results = checksSince(cwd, task.from);
  const commands = (config.checks ?? {}) as Record<string, string>;
  const allowed = allowUnconfigured(config);
  const status: Status = { label: "Verified", passed: [], failed: [], missing: [], unconfigured: [], waived: [] };
  for (const name of taskChecks(config, task.tier, task.playbook)) {
    const mechanical = !JUDGEMENT_CHECKS.includes(name) && !name.startsWith("skill:");
    if (mechanical && !commands[name]) {
      (allowed.includes(name) ? status.waived : status.unconfigured).push(name);
      continue;
    }
    const r = results.get(name);
    if (!r || (mechanical && r.how !== "ran")) status.missing.push(name);
    else if (r.status === "pass") status.passed.push(name);
    else status.failed.push(name);
  }
  const low = belowFloor(cwd, config, task);
  if (low) status.floor = low;
  if (status.failed.length) status.label = "Blocked";
  else if (status.floor || status.unconfigured.length) status.label = "Not verified";
  else if (status.missing.length) status.label = status.passed.length ? "Partially verified" : "Not verified";
  return status;
}

// The trivial tier's mechanical checks (what every task owes) with no command and
// not waived by verify.allow_unconfigured: no task can be Verified until they're set.
export function noChecksWarning(config: Table): string | undefined {
  const commands = (config.checks ?? {}) as Record<string, unknown>;
  const allowed = allowUnconfigured(config);
  const missing = requiredChecks(config, "trivial").filter((n) => !JUDGEMENT_CHECKS.includes(n) && !(typeof commands[n] === "string" && (commands[n] as string).trim()) && !allowed.includes(n));
  if (!missing.length) return undefined;
  return `no command is set for ${missing.map((n) => `checks.${n}`).join(", ")}, so no task can be Verified. Ask the user to add one, e.g. \`saw config set checks.${missing[0]} "bun test"\` (any command that runs it), or to list checks that need none in verify.allow_unconfigured`;
}

// Why a task isn't Verified, for the Stop gate, the verify guard and saw task end.
export function statusProblems(s: Status): string {
  return [
    s.floor ? `tier too low: ${s.floor}` : "",
    s.failed.length ? `failed: ${s.failed.join(", ")}` : "",
    s.missing.length ? `not run: ${s.missing.join(", ")}` : "",
    s.unconfigured.length ? `not configured: ${s.unconfigured.join(", ")} (set checks.<name> in workflow.toml, or list it in verify.allow_unconfigured)` : "",
  ].filter(Boolean).join("; ");
}

// .saw/status.json: the open task's tier, playbook and verification label, for the
// mods (prompt band, workflow pane), which can read files but not run taskStatus.
// `started` ties it to one task, so a stale file is ignored. Removed with no task open.
// `known`: a status the caller already computed for the open task, so it isn't computed twice.
export function writeStatusFile(cwd: string, config: Table, known?: Status): void {
  const path = join(dir(cwd), "status.json");
  const task = currentTask(cwd);
  if (!task) {
    rmSync(path, { force: true });
    return;
  }
  try {
    const s = known ?? taskStatus(cwd, config, task);
    writeFileSync(path, JSON.stringify({ started: task.started, tier: task.tier, playbook: task.playbook, label: s.label, ...(task.provisional ? { provisional: true } : {}) }) + "\n");
  } catch {
    // Display only: a failed write never blocks a command or hook.
  }
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
    ...(s.floor ? [`- Not verified: tier too low: ${s.floor}`] : []),
    ...s.unconfigured.map((n) => `- Not verified: \`${n}\` (not configured)`),
    ...s.waived.map((n) => `- Skipped: \`${n}\` (no command; verify.allow_unconfigured)`),
  ].join("\n");
}

// Shell writes (sed -i, redirects) never fire the edit hook. A hash of `git status
// --porcelain` (saw's own .saw state excluded), kept in the session's state file, shows whether the working tree
// changed since session start. undefined: not a git repo, or git failed.
export function gitStatusHash(cwd: string): string | undefined {
  try {
    const r = spawnSync("git", ["status", "--porcelain", "--", ".", ":(exclude).saw"], { cwd, encoding: "utf8", timeout: 5000 });
    return r.status === 0 ? createHash("sha1").update(r.stdout).digest("hex") : undefined;
  } catch {
    return undefined;
  }
}

export function storedTreeHash(cwd: string, sessionId: string): string | undefined {
  try {
    const s = JSON.parse(readFileSync(sessionFile(cwd, sessionId), "utf8")) as { session_id?: string; tree?: string };
    return s.session_id === sessionId ? s.tree : undefined;
  } catch {
    return undefined;
  }
}

// Merges into the session's state file, keeping the fields sessions.ts keeps there.
export function storeTreeHash(cwd: string, sessionId: string, tree: string): void {
  let state: Record<string, unknown> = { session_id: sessionId };
  try {
    const s = JSON.parse(readFileSync(sessionFile(cwd, sessionId), "utf8")) as Record<string, unknown>;
    if (s.session_id === sessionId) state = s;
  } catch {
    // No state yet: start clean.
  }
  mkdirSync(dirname(sessionFile(cwd, sessionId)), { recursive: true });
  writeFileSync(sessionFile(cwd, sessionId), JSON.stringify({ ...state, tree }, null, 2) + "\n");
}

const TREE_CHANGED = "The working tree changed since the session started (a shell write, build output or an edit made outside the agent), but no saw task is open. ";
const UNTASKED = "Files were edited but no saw task is open, so nothing was verified. Use the router skill to classify the work, run `saw task start --tier <t> --playbook <p>` (or `saw task adhoc` for a one-off edit), then run its checks.";

function git(cwd: string, args: string[]): string | undefined {
  const p = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, timeout: 15000 });
  return p.status === 0 ? p.stdout.trim() : undefined;
}

// A .git entry in cwd or an ancestor: cheaper than letting git fail on every gate call.
function insideRepo(cwd: string): boolean {
  for (let d = resolve(cwd); ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return true;
    if (dirname(d) === d) return false;
  }
}

const MAX_UNTRACKED_READ = 200;

// A file's content hash: SHA-1 of the bytes up to 1 MB, size and mtime past it
// (a rewrite then reads as changed: the guard fails closed, not open).
// No stat-then-read on the path (a file-system race): readlink answers only for a
// symlink, and the rest is checked and read through one file descriptor.
function contentHash(abs: string): string {
  try {
    return `link:${readlinkSync(abs)}`;
  } catch {
    // not a symlink (or gone): fall through
  }
  let fd: number;
  try {
    fd = openSync(abs, "r");
  } catch (e) {
    // a submodule: its own commits are its own repo's business (Windows can't open a dir)
    return (e as NodeJS.ErrnoException).code === "EISDIR" || (e as NodeJS.ErrnoException).code === "EPERM" ? "dir" : "deleted";
  }
  try {
    const st = fstatSync(fd);
    if (st.isDirectory()) return "dir";
    if (st.size > 1_000_000) return `big:${st.size}:${st.mtimeMs}`;
    return createHash("sha1").update(readFileSync(fd)).digest("hex");
  } catch {
    return "deleted";
  } finally {
    closeSync(fd);
  }
}

// The repository's top folder; undefined outside git.
const repoTop = (cwd: string): string | undefined => (insideRepo(cwd) ? git(cwd, ["rev-parse", "--show-toplevel"]) : undefined);

// The working tree's changes vs HEAD when a task starts, so the floor measures only what the task adds.
function dirtyBaseline(cwd: string): Record<string, string> | undefined {
  const fp = treeFingerprint(cwd);
  const entries = Object.entries(fp ?? {}).filter(([, h]) => h !== "deleted").slice(0, 200);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

// path (from the repository's top) -> content hash ("deleted" for a removed file)
// of every change against HEAD, staged or not, plus untracked files, across the
// whole repository (git commit -a from a sub-project commits all of it); saw's own
// .saw state excluded. Staging doesn't change it, so a `git add` between saw task
// end and git commit keeps a Verified tree verified. Paths come NUL-separated (-z),
// so no file name (quotes, tabs, newlines) can dodge the comparison.
// undefined: not a git repo, or git failed.
export function treeFingerprint(cwd: string): Record<string, string> | undefined {
  const top = repoTop(cwd);
  if (!top) return undefined;
  const list = (args: string[]): string[] | undefined => {
    const p = spawnSync("git", args, { cwd: top, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 15000 });
    return p.status === 0 ? p.stdout.split("\0").filter(Boolean) : undefined;
  };
  const head = git(cwd, ["rev-parse", "--verify", "-q", "HEAD"]);
  // No commit yet: everything in the index is new.
  const tracked = head ? list(["diff", "--name-only", "-z", "--no-renames", "HEAD"]) : list(["ls-files", "-z"]);
  const untracked = list(["ls-files", "-z", "--others", "--exclude-standard"]);
  if (!tracked || !untracked) return undefined;
  const out: Record<string, string> = {};
  for (const path of new Set([...tracked, ...untracked])) {
    if (/(^|\/)\.saw\//.test(path)) continue;
    out[path] = contentHash(join(top, path));
  }
  return out;
}

// .saw/verified-tree.json: the working tree as it was when the last task closed Verified.
const verifiedTreePath = (cwd: string): string => join(dir(cwd), "verified-tree.json");

export function recordVerifiedTree(cwd: string): void {
  const files = treeFingerprint(cwd);
  if (!files) return;
  mkdirSync(dir(cwd), { recursive: true });
  writeFileSync(verifiedTreePath(cwd), JSON.stringify({ at: new Date().toISOString(), files }, null, 2) + "\n");
}

// Changed files no Verified task covers: new since the last Verified close, or
// different from what it verified. Empty for a clean tree, or outside git; when
// git can't list the tree inside a repository, that is reported (fails closed).
export function unverifiedChanges(cwd: string): string[] {
  if (!insideRepo(cwd)) return [];
  const now = treeFingerprint(cwd);
  if (!now) return ["(git could not list the working tree)"];
  let verified: Record<string, string> = {};
  try {
    const v = JSON.parse(readFileSync(verifiedTreePath(cwd), "utf8")) as { files?: Record<string, string> };
    if (v?.files && typeof v.files === "object") verified = v.files;
  } catch {
    // No Verified task closed here yet: every change is unverified.
  }
  return Object.entries(now).filter(([path, hash]) => verified[path] !== hash).map(([path]) => path);
}

export interface Floor {
  floor: (typeof TIERS)[number];
  why: string;
}

// The least tier the work since the task started allows: standard once it passes
// routing.trivial_max_files / trivial_max_lines, critical when a changed path
// matches routing.critical_paths. Fails open (trivial) outside git or when git fails.
export function tierFloor(cwd: string, config: Table, task: Task): Floor {
  const routing = (config.routing ?? {}) as { trivial_max_files?: number; trivial_max_lines?: number; critical_paths?: string[] };
  const base = task.base && /^[0-9a-f]{7,64}$/.test(task.base) ? task.base : "HEAD";
  if (!insideRepo(cwd)) return { floor: "trivial", why: "" };
  const numstat = git(cwd, ["-c", "core.quotepath=off", "diff", "--numstat", "--no-renames", base]);
  if (numstat === undefined) return { floor: "trivial", why: "" };
  const untracked = git(cwd, ["ls-files", "--others", "--exclude-standard"]);
  if (untracked === undefined) return { floor: "trivial", why: "" };
  const changed = new Map<string, number>();
  for (const row of numstat.split("\n").filter(Boolean)) {
    const [add, del, ...rest] = row.split("	");
    const path = rest.join("	");
    if (!path.startsWith(".saw/")) changed.set(path, (Number(add) || 0) + (Number(del) || 0));
  }
  let read = 0;
  for (const path of untracked.split("\n").filter(Boolean)) {
    if (path.startsWith(".saw/") || changed.has(path)) continue;
    let n = 1;
    // Reading is capped: past it a file still counts, its lines don't.
    if (read++ < MAX_UNTRACKED_READ) {
      try {
        // One descriptor for the size check and the read, so the file can't change between them.
        const fd = openSync(join(cwd, path), "r");
        try {
          if (fstatSync(fd).size <= 1_000_000) n = readFileSync(fd, "utf8").split("\n").length;
        } finally {
          closeSync(fd);
        }
      } catch {
        // Unreadable (a directory, a race): the file still counts.
      }
    }
    changed.set(path, n);
  }
  // Files already dirty when the task started, and unchanged since, aren't this task's work.
  const before = Object.entries(task.baseDirty ?? {}).filter(([path]) => changed.has(path));
  if (before.length) {
    const top = repoTop(cwd) ?? cwd;
    for (const [path, hash] of before) if (contentHash(join(top, path)) === hash) changed.delete(path);
  }
  const files = new Set(changed.keys());
  let lines = 0;
  for (const n of changed.values()) lines += n;
  const critical = (routing.critical_paths ?? []).map((g) => new Bun.Glob(g));
  const hit = [...files].find((f) => critical.some((g) => g.match(f)));
  if (hit) return { floor: "critical", why: `${hit} matches routing.critical_paths` };
  const maxFiles = routing.trivial_max_files ?? 3;
  const maxLines = routing.trivial_max_lines ?? 60;
  if (files.size > maxFiles || lines > maxLines) return { floor: "standard", why: `${files.size} files, ${lines} lines changed; trivial allows ${maxFiles} files and ${maxLines} lines` };
  return { floor: "trivial", why: "" };
}

const tierRank = (t: string): number => (TIERS as readonly string[]).indexOf(t);

// Set when the open task's tier is below the floor.
export function belowFloor(cwd: string, config: Table, task: Task): string | undefined {
  // Nothing is above critical: skip the git calls.
  if (task.tier === "critical") return undefined;
  const f = tierFloor(cwd, config, task);
  return tierRank(task.tier) < tierRank(f.floor)
    ? `the diff needs at least ${f.floor} (${f.why}) but this task is ${task.tier}; run \`saw task retier ${f.floor}\``
    : undefined;
}

// saw task retier: keeps the task's check history; never below the floor.
export function retierTask(cwd: string, config: Table, tier: string): Task {
  if (!(TIERS as readonly string[]).includes(tier)) throw new Error(`tier must be one of ${TIERS.join(" | ")}`);
  const task = currentTask(cwd);
  if (!task) throw new Error("no open task; start one with saw task start --tier <t> --playbook <p>");
  const f = tierFloor(cwd, config, task);
  if (tierRank(tier) < tierRank(f.floor)) throw new Error(`can't lower to ${tier}: the diff needs at least ${f.floor} (${f.why})`);
  // Retiering confirms a provisional task (routing.auto = "open"), at the same tier or another.
  const { provisional: _confirmed, ...rest } = task;
  const next = { ...rest, tier };
  writeTask(cwd, next);
  return next;
}

// Stop hook: returns the JSON to print, or undefined to allow the stop.
export function gate(
  cwd: string,
  config: Table,
  hookInput: { stop_hook_active?: boolean; transcript_path?: string; session_id?: string },
  // Filled with the status the gate computed, for writeStatusFile.
  out?: { status?: Status },
): { decision: "block"; reason: string } | undefined {
  const task = currentTask(cwd);
  if (task && typeof hookInput.transcript_path === "string") saveTranscript(cwd, task, hookInput.transcript_path);
  const features = (config.features ?? {}) as Record<string, boolean>;
  if (!features.verify_hook || hookInput.stop_hook_active) return undefined;
  if (!task) {
    // Files changed but routing never ran, so there is nothing to verify against.
    const marker = join(dir(cwd), "untasked-edits");
    if (!existsSync(marker)) {
      // No edit hook fired: a shell write shows only as a changed working tree.
      const sid = hookInput.session_id;
      if (!sid || !isSawProject(cwd)) return undefined;
      const before = storedTreeHash(cwd, sid);
      const now = before ? gitStatusHash(cwd) : undefined;
      if (!now || now === before) return undefined;
      storeTreeHash(cwd, sid, now);
      return { decision: "block", reason: TREE_CHANGED + UNTASKED };
    }
    // Block once per batch of edits; the next edit sets the marker again.
    rmSync(marker, { force: true });
    const sid = hookInput.session_id;
    const now = sid && storedTreeHash(cwd, sid) ? gitStatusHash(cwd) : undefined;
    if (sid && now) storeTreeHash(cwd, sid, now); // this change is reported: don't block it again as a shell write
    return { decision: "block", reason: UNTASKED };
  }
  const s = taskStatus(cwd, config, task);
  if (out) out.status = s;
  // Soft routing doesn't interrupt a provisional task (opened by routing.auto = "open"): its
  // status still shows in saw task status and the status file, and verify.mode = hard still holds commits.
  if (task.provisional && ((config.routing ?? {}) as { mode?: string }).mode !== "hard") return undefined;
  if (s.floor) return { decision: "block", reason: `Tier too low: ${s.floor}.` };
  if (s.label === "Verified") return undefined;
  // Debugging is phased in when needed: a check failing twice means guessing has stopped working.
  const repeated = repeatedFailures(cwd, task);
  const debug = repeated.length && task.playbook !== "debug"
    ? ` ${repeated.join(", ")} failed more than once: switch to the debug playbook (reproduce, hypothesise, then fix) before another attempt.`
    : "";
  return {
    decision: "block",
    reason: `${task.tier} task is ${s.label} (${statusProblems(s)}).${debug} Run each with \`saw run <check>\`, or \`saw task record <check> pass|fail --note "..."\` for reviews. If a check can't run here, report it as Not verified and run \`saw task end --reason "<why>"\`.`,
  };
}

export function repeatedFailures(cwd: string, task: Task): string[] {
  const counts = new Map<string, number>();
  const latest = checksSince(cwd, task.from);
  for (const r of checkResults(cwd, task.from)) if (r.status === "fail") counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  // Only checks still failing: one that has since passed needs no debugging.
  return [...counts].filter(([name, n]) => n >= 2 && latest.get(name)?.status === "fail").map(([name]) => name);
}
