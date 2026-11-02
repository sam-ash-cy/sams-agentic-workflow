// `saw review-session`: an independent audit session per unit of work
// ([review_session]). A fresh, read-only session that hasn't seen the builder's
// reasoning grills the unit against its plan and audits it for holes; its
// findings are recorded for the builder to fix or answer, and for metrics.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { baseBranch } from "./config";
import type { Table } from "./defaults";

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
  // undefined: the report had no verdict line, so the review didn't finish and doesn't count.
  verdict?: "pass" | "fail";
  // "ran": saw review-session run spawned the reviewer; "recorded": a report
  // file handed to saw review-session record (anyone could have written it).
  how?: "ran" | "recorded";
  // HMAC over the record and its report's contents, with the per-machine key in
  // ~/.saw/review-key; set only when saw ran the session itself.
  sig?: string;
}

// The key lives outside the project, where saw guard denies edits
// (edit_global) and any tool call that names it, so the agent can't sign a
// forged record. Created on first use; never committed, never printed.
export const REVIEW_KEY = "review-key";
export const reviewKeyPath = (home = process.env.SAW_HOME ?? join(homedir(), ".saw")): string => join(home, REVIEW_KEY);

function reviewKey(create: boolean): Buffer | undefined {
  const path = reviewKeyPath();
  if (existsSync(path)) return Buffer.from(readFileSync(path, "utf8").trim(), "hex");
  if (!create) return undefined;
  mkdirSync(dirname(path), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(path, key.toString("hex") + "\n", { mode: 0o600 });
  return key;
}

function signature(key: Buffer, r: ReviewRecord, report: string): string {
  const digest = createHash("sha256").update(report).digest("hex");
  return createHmac("sha256", key).update(JSON.stringify([r.at, r.unit, r.kind, r.mode, r.findings, r.verdict ?? null, r.how ?? null, digest])).digest("hex");
}

// A record counts as saw-run only if its signature matches the record and the
// report file as they are now: editing either, or writing a record by hand, fails.
export function signatureValid(cwd: string, r: ReviewRecord): boolean {
  const key = reviewKey(false);
  const file = resolve(cwd, r.report);
  if (!key || !r.sig || !existsSync(file)) return false;
  const want = Buffer.from(signature(key, r, readFileSync(file, "utf8")), "hex");
  const got = Buffer.from(r.sig, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

export const reportVerdict = (report: string): "pass" | "fail" | undefined =>
  (/^\s*verdict:\s*(pass|fail)\b/im.exec(report)?.[1]?.toLowerCase() as "pass" | "fail" | undefined);

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

// For `run`: the change, written to a file the reviewer reads, so the
// sub-session needs no shell at all (git diff/log accept --output=<file>).
export function writeChange(cwd: string, config: Table, id: string): string {
  const base = baseBranch(config);
  const git = (...a: string[]): string => {
    const p = Bun.spawnSync(["git", ...a], { cwd, stdout: "pipe", stderr: "pipe" });
    return p.exitCode === 0 ? p.stdout.toString() : `(git ${a[0]} failed: ${p.stderr.toString().trim()})\n`;
  };
  const rel = join(".saw", "reviews", `${safeId(id)}.diff`);
  mkdirSync(join(cwd, ".saw", "reviews"), { recursive: true });
  writeFileSync(join(cwd, rel), [
    "## git status --short", git("status", "--short"),
    `## git log ${base}..HEAD`, git("log", "--oneline", `${base}..HEAD`),
    `## git diff ${base}...HEAD`, git("diff", `${base}...HEAD`),
    "## git diff (uncommitted)", git("diff", "HEAD"),
  ].join("\n"));
  return rel.replace(/\\/g, "/");
}

export function reviewBrief(cwd: string, config: Table, kind: string, id: string, tier: string, changeFile?: string): string {
  const s = settings(config);
  const mode = s.mode ?? "both";
  const base = baseBranch(config);
  const plan = join("docs", "plans", `${safeId(id)}.md`);
  const sources = [existsSync(join(cwd, plan)) ? `the plan ${plan.replace(/\\/g, "/")}` : "the plan (none found under docs/plans; say so)"];
  if (existsSync(join(cwd, "docs", "plans", "roadmap.md"))) sources.push("the roadmap docs/plans/roadmap.md");
  const jobs: string[] = [];
  if (mode !== "audit") jobs.push("Grill: check the work against the plan and its acceptance criteria. Every claim in \"Built\" must be in the diff and tested; question each decision that isn't justified.");
  if (mode !== "grill") jobs.push("Audit: look for holes. Missing features, settings that nothing reads, untested paths and error cases, docs that disagree with the code, gaps against the roadmap.");
  return [
    `You are an independent reviewer of ${kind} ${id} (tier ${tier}). You have not seen the builder's reasoning; judge only what is in the repo.`,
    `Read-only: do not edit, commit or push. Stay within about ${reviewBudget(config, tier)} tokens.`,
    changeFile
      ? `Read ${sources.join(" and ")}, then the change in ${changeFile} (status, log and diff against ${base}).`
      : `Read ${sources.join(" and ")}, then the change: \`git diff ${base}...HEAD\` and \`git status --short\` for uncommitted work.`,
    ...jobs,
    "Report: one line per finding, most severe first, each `- [category] file:line: what is wrong, and the failure it causes`. Then `verdict: pass` or `verdict: fail`.",
    "Your last message is the report itself and nothing else: saw reads only that. Don't save learnings or notes (no `trail note`); a finding worth keeping goes in the report.",
  ].join("\n");
}

// Findings are the report's lines that start with "- [".
export const countFindings = (report: string): number => report.split("\n").filter((l) => /^\s*- \[/.test(l)).length;

export function recordReview(cwd: string, kind: string, id: string, mode: string, report: string, now = new Date(), how: "ran" | "recorded" = "recorded"): ReviewRecord {
  const dir = join(cwd, ".saw", "reviews");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${safeId(id)}.md`);
  writeFileSync(file, report.endsWith("\n") ? report : report + "\n");
  const rec: ReviewRecord = { at: now.toISOString(), unit: id, kind, mode, findings: countFindings(report), report: file, verdict: reportVerdict(report), how };
  if (how === "ran") rec.sig = signature(reviewKey(true)!, rec, readFileSync(file, "utf8"));
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

export const reviewedSince = (cwd: string, id: string, since = ""): boolean => readReviews(cwd).some((r) => r.unit === id && r.at >= since && r.verdict !== undefined);

// The headless sub-session: edits and shell writes disallowed, read tools only.
// The brief goes on stdin: a multi-line argument breaks the claude.cmd shim npm installs on Windows.
export function reviewArgv(): string[] {
  return ["claude", "-p", "--allowedTools", "Read,Grep,Glob", "--disallowedTools", "Bash,Edit,Write,MultiEdit,NotebookEdit"];
}
