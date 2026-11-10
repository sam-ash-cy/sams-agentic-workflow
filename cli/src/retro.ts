// `saw retro`: turns repeated failures in .saw/metrics.jsonl into proposals.
// A check that failed in at least retro.repeat_threshold tasks gets one
// proposal file in retro.proposals_dir. The agent fills in the root cause and
// the fix (retro-promote skill); a person approves it under `propose` autonomy.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TaskMetric } from "./metrics";

export interface Candidate {
  check: string;
  tasks: number;
  failures: number;
  last: string;
}

export interface Proposal {
  file: string;
  check: string;
  status: string;
  // Date the fix was merged; the promotion_effect panel compares before and after.
  promoted?: string;
}

export function candidates(metrics: TaskMetric[], threshold: number): Candidate[] {
  const by = new Map<string, Candidate>();
  for (const m of metrics) {
    for (const [check, n] of Object.entries(m.findings ?? {})) {
      if (!n) continue;
      const c = by.get(check) ?? { check, tasks: 0, failures: 0, last: "" };
      c.tasks += 1;
      c.failures += n;
      if (m.at > c.last) c.last = m.at;
      by.set(check, c);
    }
  }
  return [...by.values()].filter((c) => c.tasks >= threshold).sort((a, b) => b.tasks - a.tasks || a.check.localeCompare(b.check));
}

// Settings changes the evidence supports, as `saw config set` commands for a
// person to run: printed, never applied.
export function configSuggestions(metrics: TaskMetric[], config: Record<string, unknown>, threshold: number): string[] {
  const out: string[] = [];
  const budget = ((config.tokens ?? {}) as { budget?: Record<string, number> }).budget ?? {};
  for (const [tier, cap] of Object.entries(budget)) {
    const over = metrics.filter((m) => m.tier === tier && m.tokens !== undefined && m.tokens > cap).map((m) => m.tokens!).sort((a, b) => a - b);
    if (over.length < threshold) continue;
    // The median overrun, rounded up to 10k: enough for typical work, not the worst case.
    const next = Math.ceil(over[Math.floor(over.length / 2)]! / 10000) * 10000;
    out.push(`saw config set tokens.budget.${tier} ${next} --scope local   # ${over.length} ${tier} tasks went over ${cap}`);
  }
  const features = (config.features ?? {}) as Record<string, boolean>;
  const tests = candidates(metrics, threshold).find((c) => c.check === "test");
  if (tests && !features.tdd) out.push(`saw config set features.tdd true   # test failed in ${tests.tasks} tasks; write the failing test first`);
  return out;
}

// Frontmatter keys only (`key: value` lines between --- fences); no YAML parser needed.
function frontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out: Record<string, string> = {};
  for (const line of m?.[1]?.split(/\r?\n/) ?? []) {
    const kv = /^(\w+):\s*(.*?)\s*$/.exec(line);
    if (kv) out[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, "");
  }
  return out;
}

export function readProposals(dir: string): Proposal[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{4}-.*\.md$/.test(f))
    .sort()
    .flatMap((file) => {
      const fm = frontmatter(readFileSync(join(dir, file), "utf8"));
      if (!fm.check) return [];
      return [{ file, check: fm.check, status: fm.status ?? "proposed", promoted: fm.promoted || undefined }];
    });
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "check";

export function proposalText(c: Candidate, today: string): string {
  return `---
check: ${c.check}
status: proposed
created: ${today}
promoted:
tags: [proposal]
---
# ${c.check} keeps failing

## Evidence
Failed in ${c.tasks} tasks (${c.failures} failed runs), last on ${c.last.slice(0, 10)}. Source: \`.saw/metrics.jsonl\`; full logs in \`.saw/logs/\`.

## Root cause
<!-- One of: missing context | poor instruction | missing tool | missing test | reasoning error. Say why, citing the logs. -->

## Fix
<!-- Most enforceable form that works, in this order: test/lint rule (with a fix message) > hook > skill edit > AGENTS.md line. -->

## Eval case
<!-- evals/<case>/ that reproduces the failure. Record \`saw eval\` before and after; the fix lands only if no case gets worse. -->

## Decision
<!-- Approved / rejected, by whom. When merged, set \`status: promoted\` and \`promoted: YYYY-MM-DD\` above. -->
`;
}

export interface RetroResult {
  written: string[];
  open: Proposal[];
  pending: Candidate[];
}

// Writes a proposal for each candidate check that doesn't have one yet
// (unless `write` is false: suggest mode or --dry-run).
// `extra`: candidates from elsewhere, such as recurring tests (failures.ts).
export function retro(dir: string, metrics: TaskMetric[], threshold: number, write: boolean, today = new Date().toISOString().slice(0, 10), extra: Candidate[] = []): RetroResult {
  const existing = readProposals(dir);
  const covered = new Set(existing.filter((p) => p.status !== "rejected").map((p) => p.check));
  const pending = [...candidates(metrics, threshold), ...extra].filter((c) => !covered.has(c.check));
  const written: string[] = [];
  if (write && pending.length) {
    mkdirSync(dir, { recursive: true });
    // Number after every NNNN- file, not just parsed proposals, so nothing is overwritten.
    let next = readdirSync(dir).filter((f) => /^\d{4}-/.test(f)).reduce((n, f) => Math.max(n, Number(f.slice(0, 4))), 0);
    for (const c of pending) {
      const file = `${String(++next).padStart(4, "0")}-${slug(c.check)}.md`;
      writeFileSync(join(dir, file), proposalText(c, today));
      written.push(file);
    }
  }
  return { written, open: existing.filter((p) => p.status === "proposed"), pending };
}
