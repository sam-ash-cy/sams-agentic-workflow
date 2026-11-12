// `saw plan "<goal>"`: one headless planning session turns a goal into ADR
// drafts, a roadmap and `[proposed]` queue items. Afterwards the queue is
// validated here and any `[approved]` the session added is put back to
// `[proposed]`: only the owner approves.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeArgv, type Session } from "./autopilot";
import type { Table } from "./defaults";

// Read in one step rather than existsSync-then-read, so the file can't change between the check and the use (CodeQL js/file-system-race).
function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export const TIERS = ["trivial", "standard", "complex", "critical"];

// A queue item with its optional sub-lines (the shared queue format).
export interface PlanItem {
  status: string;
  slug: string;
  text: string;
  tier?: string;
  needs: string[];
  accept: string[];
  adr?: string;
  line: number;
}

export interface PlanDeps {
  claude: (argv: string[], prompt: string) => Session;
  // Paths with uncommitted changes (git status), to catch edits outside docs/.
  changed: () => string[];
  uuid: () => string;
  log: (line: string) => void;
}

// Same item rule as autopilot's parseQueue (any indentation): whatever it would
// run, the planner must see.
const ITEM = /^\s*[-*]\s+\[(\w+)\]\s+([\w.-]+):?\s*(.*)$/;
const SUB = /^\s+[-*]\s+(tier|needs|accept|adr):\s*(.*)$/;

export function parsePlanItems(text: string): PlanItem[] {
  const items: PlanItem[] = [];
  text.split("\n").forEach((l, i) => {
    const m = ITEM.exec(l);
    if (m) {
      items.push({ status: m[1].toLowerCase(), slug: m[2], text: m[3].trim(), needs: [], accept: [], line: i + 1 });
      return;
    }
    const s = SUB.exec(l);
    const cur = items[items.length - 1];
    if (!s || !cur) return;
    const v = s[2].trim();
    if (s[1] === "tier") cur.tier = v;
    else if (s[1] === "adr") cur.adr = v;
    else if (s[1] === "needs") cur.needs.push(...v.split(",").map((x) => x.trim()).filter(Boolean));
    else if (v) cur.accept.push(v);
  });
  return items;
}

export function renderItem(item: Omit<PlanItem, "line">): string {
  const out = [`- [${item.status}] ${item.slug}: ${item.text}`];
  if (item.tier) out.push(`  - tier: ${item.tier}`);
  if (item.needs.length) out.push(`  - needs: ${item.needs.join(", ")}`);
  for (const a of item.accept) out.push(`  - accept: ${a}`);
  if (item.adr) out.push(`  - adr: ${item.adr}`);
  return out.join("\n");
}

// Every problem with the queue, one line each. Empty means valid.
export function validateQueue(items: PlanItem[], exists: (path: string) => boolean = () => true): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.slug)) problems.push(`duplicate slug: ${it.slug} (line ${it.line})`);
    seen.add(it.slug);
  }
  // Items already finished need no planning metadata.
  for (const it of items.filter((x) => x.status === "proposed" || x.status === "approved")) {
    if (!it.tier) problems.push(`${it.slug}: missing tier`);
    else if (!TIERS.includes(it.tier)) problems.push(`${it.slug}: unknown tier ${it.tier}`);
    if (!it.accept.length) problems.push(`${it.slug}: no accept line`);
    if (it.adr && !exists(it.adr)) problems.push(`${it.slug}: adr not found: ${it.adr}`);
  }
  for (const it of items) for (const n of it.needs) if (!seen.has(n)) problems.push(`${it.slug}: needs unknown slug ${n}`);
  for (const c of cycles(items)) problems.push(`dependency cycle: ${c.join(" -> ")}`);
  return problems;
}

// Each dependency cycle once, as a closed path (a -> b -> a).
export function cycles(items: PlanItem[]): string[][] {
  const needs = new Map(items.map((i) => [i.slug, i.needs]));
  const state = new Map<string, 1 | 2>();
  const found: string[][] = [];
  const visit = (s: string, path: string[]): void => {
    state.set(s, 1);
    for (const n of needs.get(s) ?? []) {
      if (!needs.has(n)) continue;
      if (state.get(n) === 1) found.push([...path.slice(path.indexOf(n)), n]);
      else if (!state.has(n)) visit(n, [...path, n]);
    }
    state.set(s, 2);
  };
  for (const s of needs.keys()) if (!state.has(s)) visit(s, [s]);
  return found;
}

// Each item's block: its line plus the sub-lines under it, trimmed.
function blocks(text: string): { start: number; status: string; key: string }[] {
  const out: { start: number; status: string; key: string }[] = [];
  text.split("\n").forEach((l, i) => {
    const m = ITEM.exec(l);
    if (m) out.push({ start: i, status: m[1].toLowerCase(), key: l.trim() });
    // Every indented line under an item counts, not only known sub-lines:
    // added prose would otherwise reach the autopilot worker unreviewed.
    else if (out.length && /^\s+\S/.test(l)) out[out.length - 1].key += "\n" + l.trim();
  });
  return out;
}

// Puts back to `[proposed]` every approved item that wasn't approved, word
// for word with the same sub-lines, before the run: new approvals, rewritten
// approved items and extra copies of one. Returns the new text and the slugs.
export function revertApprovals(before: string, after: string): { text: string; reverted: string[] } {
  const was = new Map<string, number>();
  for (const b of blocks(before)) if (b.status === "approved") was.set(b.key, (was.get(b.key) ?? 0) + 1);
  const lines = after.split("\n");
  const reverted: string[] = [];
  for (const b of blocks(after)) {
    if (b.status !== "approved") continue;
    const n = was.get(b.key) ?? 0;
    if (n > 0) {
      was.set(b.key, n - 1);
      continue;
    }
    lines[b.start] = lines[b.start].replace(/\[approved\]/i, "[proposed]");
    reverted.push(ITEM.exec(lines[b.start])![2]);
  }
  return { text: lines.join("\n"), reverted };
}

// Files the session may change: docs only (ADRs, roadmap, the queue).
export function outsideDocs(before: string[], after: string[], queue: string): string[] {
  const norm = (p: string): string => p.replaceAll("\\", "/");
  const old = new Set(before.map(norm));
  return after.map(norm).filter((p) => !old.has(p) && !p.startsWith("docs/") && p !== norm(queue));
}

const BRIEF = join(import.meta.dir, "..", "..", "prompts", "plan.md");

export function planBrief(goal: string, queue: string, template?: string): string {
  if (template === undefined) {
    if (!existsSync(BRIEF)) throw new Error(`planning brief not found: ${BRIEF}`);
    template = readFileSync(BRIEF, "utf8");
  }
  // One pass with a function replacer: `$&` or `{{queue}}` in the goal stay literal.
  const vars: Record<string, string> = { goal, queue };
  return template.replace(/\{\{(goal|queue)\}\}/g, (_, k: string) => vars[k]);
}

// Planning writes docs only: reading tools plus edits under docs/ are
// allowed; shell, commits, pushes and PRs are denied. After the run, changes
// outside docs/ are caught as well (outsideDocs).
export const PLAN_ALLOWED = ["Read", "Grep", "Glob", "Edit(docs/**)", "Write(docs/**)"];
const PLAN_DENIED = ["Bash", "Bash(git commit:*)", "Bash(git push:*)", "Bash(gh:*)", "Bash(git merge:*)"];

export function planArgv(sessionId: string, maxUsd: number, base = "main", queue = "docs/plans/queue.md"): string[] {
  const argv = claudeArgv(sessionId, maxUsd, false, base);
  const i = argv.indexOf("--disallowedTools");
  if (i < 0 || i + 1 >= argv.length) throw new Error("claudeArgv no longer passes --disallowedTools");
  argv[i + 1] = [argv[i + 1], ...PLAN_DENIED].join(",");
  const allowed = queue.startsWith("docs/") ? PLAN_ALLOWED : [...PLAN_ALLOWED, `Edit(${queue})`, `Write(${queue})`];
  argv.push("--allowedTools", allowed.join(","));
  return argv;
}

export function maxUsd(config: Table): number {
  const v = Number((config.plan as Table | undefined)?.max_usd ?? 3);
  if (!Number.isFinite(v) || v <= 0) throw new Error("plan.max_usd must be a positive number");
  return v;
}

export function plan(cwd: string, config: Table, goal: string, queuePath: string, deps: PlanDeps, opts: { dryRun?: boolean; base?: string } = {}): number {
  const queue = (config.autopilot as Table).queue as string;
  let cap: number, brief: string, argv: string[];
  try {
    cap = maxUsd(config);
    brief = planBrief(goal, queue);
    argv = planArgv(deps.uuid(), cap, opts.base, queue);
  } catch (e) {
    deps.log((e as Error).message);
    return 1;
  }
  if (opts.dryRun) {
    deps.log(`would run: ${argv.slice(0, 7).join(" ")} … (prompt on stdin, cap $${cap})`);
    deps.log("brief:");
    deps.log(brief);
    return 0;
  }
  const before = readOrNull(queuePath) ?? "";
  const dirtyBefore = deps.changed();
  // ADRs of already-approved items: the session must not change what they say.
  const read = (p: string): string => readOrNull(join(cwd, p)) ?? "";
  const approvedAdrs = new Map(parsePlanItems(before).filter((i) => i.status === "approved" && i.adr).map((i) => [i.adr!, read(i.adr!)]));
  const s = deps.claude(argv, brief);
  const failed = s.is_error || s.code !== 0;
  deps.log(`session ${failed ? "failed" : "finished"} ($${s.cost_usd.toFixed(2)})`);
  if (failed && s.text) deps.log(`session said: ${s.text.slice(0, 500)}`);
  const after = readOrNull(queuePath);
  if (after === null) {
    deps.log(`no queue at ${queue}`);
    return 1;
  }
  const { text, reverted } = revertApprovals(before, after);
  if (reverted.length) {
    writeFileSync(queuePath, text);
    deps.log(`set back to [proposed] (only the owner approves): ${reverted.join(", ")}`);
  }
  const problems = validateQueue(parsePlanItems(text), (p) => existsSync(join(cwd, p)));
  for (const [p, old] of approvedAdrs) if (read(p) !== old) problems.push(`ADR of an approved item changed: ${p} (review and revert it)`);
  for (const p of outsideDocs(dirtyBefore, deps.changed(), queue)) problems.push(`changed outside docs/: ${p} (review and revert it)`);
  for (const p of problems) deps.log(`problem: ${p}`);
  if (problems.length || failed) return 1;
  deps.log(`queue ok: review ${queue} and approve items yourself`);
  return 0;
}
