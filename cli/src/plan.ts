// `saw plan "<goal>"`: one headless planning session turns a goal into ADR
// drafts, a roadmap and `[proposed]` queue items. Afterwards the queue is
// validated here and any `[approved]` the session added is put back to
// `[proposed]`: only the owner approves.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeArgv, type Session } from "./autopilot";
import type { Table } from "./defaults";

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
  uuid: () => string;
  log: (line: string) => void;
}

const ITEM = /^\s*[-*]\s+\[(\w+)\]\s+([\w.-]+):?\s*(.*)$/;
const SUB = /^\s+[-*]\s+(tier|needs|accept|adr):\s*(.*)$/;

export function parsePlanItems(text: string): PlanItem[] {
  const items: PlanItem[] = [];
  text.split("\n").forEach((l, i) => {
    const m = ITEM.exec(l);
    if (m && !/^\s{2,}/.test(l)) {
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
export function validateQueue(items: PlanItem[]): string[] {
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

// Puts back to `[proposed]` every item that is `[approved]` now but wasn't
// before the run. Returns the new text and the slugs it changed.
export function revertApprovals(before: string, after: string): { text: string; reverted: string[] } {
  const was = new Set(parsePlanItems(before).filter((i) => i.status === "approved").map((i) => i.slug));
  const reverted: string[] = [];
  const text = after.split("\n").map((l) => {
    const m = ITEM.exec(l);
    if (!m || /^\s{2,}/.test(l) || m[1].toLowerCase() !== "approved" || was.has(m[2])) return l;
    reverted.push(m[2]);
    return l.replace(/\[approved\]/i, "[proposed]");
  }).join("\n");
  return { text, reverted };
}

const BRIEF = join(import.meta.dir, "..", "..", "prompts", "plan.md");

export function planBrief(goal: string, queue: string, template = existsSync(BRIEF) ? readFileSync(BRIEF, "utf8") : ""): string {
  return template.replaceAll("{{goal}}", goal).replaceAll("{{queue}}", queue);
}

// Planning writes docs only: no commits, pushes or PRs.
export function planArgv(sessionId: string, maxUsd: number, base = "main"): string[] {
  const argv = claudeArgv(sessionId, maxUsd, false, base);
  const i = argv.indexOf("--disallowedTools");
  argv[i + 1] = [argv[i + 1], "Bash(git commit:*)", "Bash(git push:*)", "Bash(gh pr create:*)"].join(",");
  return argv;
}

export function plan(cwd: string, config: Table, goal: string, queuePath: string, deps: PlanDeps, opts: { dryRun?: boolean; base?: string } = {}): number {
  const maxUsd = Number((config.plan as Table | undefined)?.max_usd ?? 3);
  const queue = (config.autopilot as Table).queue as string;
  const brief = planBrief(goal, queue);
  const id = deps.uuid();
  const argv = planArgv(id, maxUsd, opts.base);
  if (opts.dryRun) {
    deps.log(`would run: ${argv.slice(0, 7).join(" ")} … (prompt on stdin, cap $${maxUsd})`);
    deps.log("brief:");
    deps.log(brief);
    return 0;
  }
  const before = existsSync(queuePath) ? readFileSync(queuePath, "utf8") : "";
  const s = deps.claude(argv, brief);
  deps.log(`session ${s.is_error || s.code ? "failed" : "finished"} ($${s.cost_usd.toFixed(2)})`);
  if (!existsSync(queuePath)) {
    deps.log(`no queue at ${queue}`);
    return 1;
  }
  const { text, reverted } = revertApprovals(before, readFileSync(queuePath, "utf8"));
  if (reverted.length) {
    writeFileSync(queuePath, text);
    deps.log(`set back to [proposed] (only the owner approves): ${reverted.join(", ")}`);
  }
  const problems = validateQueue(parsePlanItems(text));
  for (const p of problems) deps.log(`problem: ${p}`);
  if (problems.length || s.is_error || s.code) return 1;
  deps.log(`queue ok: review ${queue} and approve items yourself`);
  return 0;
}
