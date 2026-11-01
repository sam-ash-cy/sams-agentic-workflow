// `saw review-session`: an independent audit session per unit of work
// ([review_session]). A fresh, read-only session that hasn't seen the builder's
// reasoning grills the unit against its plan and audits it for holes; its
// findings are recorded for the builder to fix or answer, and for metrics.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Table } from "./defaults";

export const REVIEW_MODES = ["grill", "audit", "both"] as const;

export interface ReviewSettings {
  enabled?: boolean;
  when?: string[];
  mode?: string;
  budget_by_tier?: Record<string, number>;
}

export interface ReviewRecord {
  at: string;
  unit: string;
  kind: string;
  mode: string;
  findings: number;
  report: string;
}

const settings = (config: Table): ReviewSettings => (config.review_session ?? {}) as ReviewSettings;

// The tier's token budget; 0 (or no entry) skips the review for that tier.
export const reviewBudget = (config: Table, tier: string): number => settings(config).budget_by_tier?.[tier] ?? 0;

// Whether a unit of this kind, on this tier, gets a review session.
export function reviewApplies(config: Table, kind: string, tier: string): boolean {
  const s = settings(config);
  return s.enabled === true && (s.when ?? []).includes(kind) && reviewBudget(config, tier) > 0;
}

// Unit ids become file names: keep them to one safe path segment.
const safeId = (id: string): string => id.replace(/[^\w.-]/g, "_").replace(/^\.+/, "_");

export function reviewBrief(cwd: string, config: Table, kind: string, id: string, tier: string): string {
  const s = settings(config);
  const mode = s.mode ?? "both";
  const base = ((config.repo ?? {}) as { protect?: { branch?: string } }).protect?.branch || "main";
  const plan = join("docs", "plans", `${safeId(id)}.md`);
  const sources = [existsSync(join(cwd, plan)) ? `the plan ${plan.replace(/\\/g, "/")}` : "the plan (none found under docs/plans; say so)"];
  if (existsSync(join(cwd, "docs", "BLUEPRINT.md"))) sources.push("docs/BLUEPRINT.md");
  const jobs: string[] = [];
  if (mode !== "audit") jobs.push("Grill: check the work against the plan and its acceptance criteria. Every claim in \"Built\" must be in the diff and tested; question each decision that isn't justified.");
  if (mode !== "grill") jobs.push("Audit: look for holes. Missing features, settings that nothing reads, untested paths and error cases, docs that disagree with the code, gaps against the blueprint.");
  return [
    `You are an independent reviewer of ${kind} ${id} (tier ${tier}). You have not seen the builder's reasoning; judge only what is in the repo.`,
    `Read-only: do not edit, commit or push. Stay within about ${reviewBudget(config, tier)} tokens.`,
    `Read ${sources.join(" and ")}, then the change: \`git diff ${base}...HEAD\` and \`git status --short\` for uncommitted work.`,
    ...jobs,
    "Report: one line per finding, most severe first, each `- [category] file:line: what is wrong, and the failure it causes`. Then `verdict: pass` or `verdict: fail`.",
  ].join("\n");
}

// Findings are the report's lines that start with "- [".
export const countFindings = (report: string): number => report.split("\n").filter((l) => /^\s*- \[/.test(l)).length;

export function recordReview(cwd: string, kind: string, id: string, mode: string, report: string, now = new Date()): ReviewRecord {
  const dir = join(cwd, ".saw", "reviews");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${safeId(id)}.md`);
  writeFileSync(file, report.endsWith("\n") ? report : report + "\n");
  const rec: ReviewRecord = { at: now.toISOString(), unit: id, kind, mode, findings: countFindings(report), report: file };
  appendFileSync(join(cwd, ".saw", "reviews.jsonl"), JSON.stringify(rec) + "\n");
  return rec;
}

export function readReviews(cwd: string): ReviewRecord[] {
  const path = join(cwd, ".saw", "reviews.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).flatMap((l) => {
    try {
      return [JSON.parse(l) as ReviewRecord];
    } catch {
      return [];
    }
  });
}

export const reviewedSince = (cwd: string, id: string, since = ""): boolean => readReviews(cwd).some((r) => r.unit === id && r.at >= since);

// The headless sub-session: edits and shell writes disallowed, read tools only.
export function reviewArgv(brief: string): string[] {
  return ["claude", "-p", brief, "--allowedTools", "Read,Grep,Glob,Bash(git diff:*),Bash(git status:*),Bash(git log:*)", "--disallowedTools", "Edit,Write,MultiEdit,NotebookEdit"];
}
