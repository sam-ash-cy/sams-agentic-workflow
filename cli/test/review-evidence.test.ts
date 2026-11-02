import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { layerPaths, loosens, resolve } from "../src/config";
import { run } from "../src/main";
import { recordReview } from "../src/review-session";
import { currentTask, reviewEvidence, startTask, taskReport } from "../src/task";

const PASS = "- [nit] a.ts:1: naming\nverdict: pass\n";

function project(mode: string, local = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "saw-ev-"));
  writeFileSync(join(dir, "workflow.toml"), `[verify]\nrequire_review_evidence = "${mode}"\n`);
  if (local) writeFileSync(join(dir, "workflow.local.toml"), local);
  return dir;
}
const config = (dir: string) => resolve(dir, {}, layerPaths(dir)).config;

function saved(dir: string, name: string, text: string): string {
  mkdirSync(join(dir, ".saw", "reviews"), { recursive: true });
  writeFileSync(join(dir, ".saw", "reviews", name), text);
  return join(".saw", "reviews", name);
}

test("off (the default): a review pass needs nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "saw-ev-"));
  writeFileSync(join(dir, "workflow.toml"), "");
  const task = startTask(dir, "standard", "feature");
  expect(reviewEvidence(dir, config(dir), task, "code_review", "pass")).toEqual({});
});

test("a committed workflow.toml can require evidence but never waive it", () => {
  expect(loosens("verify.require_review_evidence", "agent")).toBe(false);
  expect(loosens("verify.require_review_evidence", "review_session")).toBe(false);
  // Your own layer may lower it.
  const dir = project("review_session", '[verify]\nrequire_review_evidence = "off"\n');
  expect((config(dir).verify as { require_review_evidence: string }).require_review_evidence).toBe("off");
  // A cloned repo's workflow.toml can't lower what your global layer set.
  const strict = mkdtempSync(join(tmpdir(), "saw-ev-"));
  writeFileSync(join(strict, "workflow.toml"), '[verify]\nrequire_review_evidence = "off"\n');
  const paths = { ...layerPaths(strict), global: join(strict, "g.toml") };
  writeFileSync(paths.global, '[verify]\nrequire_review_evidence = "agent"\n');
  const r = resolve(strict, {}, paths);
  expect((r.config.verify as { require_review_evidence: string }).require_review_evidence).toBe("agent");
  expect(r.warnings.join(" ")).toContain("weaken verify.require_review_evidence");
});

test("agent: a pass needs a passing report under .saw/reviews/ written during this task", () => {
  const dir = project("agent");
  const c = config(dir);
  const task = startTask(dir, "standard", "feature");
  expect(reviewEvidence(dir, c, task, "code_review", "pass").problem).toContain("no review report");
  expect(reviewEvidence(dir, c, task, "code_review", "fail")).toEqual({}); // a fail needs nothing
  expect(reviewEvidence(dir, c, task, "docs", "pass")).toEqual({}); // only the two reviews
  expect(reviewEvidence(dir, c, task, "code_review", "pass", saved(dir, "cr.md", PASS))).toEqual({ report: ".saw/reviews/cr.md" });
  expect(reviewEvidence(dir, c, task, "code_review", "pass", saved(dir, "bad.md", "looks fine")).problem).toContain("no verdict");
  expect(reviewEvidence(dir, c, task, "code_review", "pass", saved(dir, "f.md", "verdict: fail\n")).problem).toContain("verdict: fail");
  writeFileSync(join(dir, "elsewhere.md"), PASS);
  expect(reviewEvidence(dir, c, task, "code_review", "pass", "elsewhere.md").problem).toContain("under .saw/reviews/");
  expect(reviewEvidence(dir, c, task, "code_review", "pass", join(".saw", "reviews", "..", "..", "elsewhere.md")).problem).toContain("under .saw/reviews/");
  const old = saved(dir, "old.md", PASS);
  utimesSync(join(dir, old), new Date("2020-01-01"), new Date("2020-01-01"));
  expect(reviewEvidence(dir, c, task, "code_review", "pass", old).problem).toContain("before this task started");
  // A review session (run or recorded) also counts under agent.
  recordReview(dir, "feature", "x", "both", PASS);
  expect(reviewEvidence(dir, c, task, "security_review", "pass").report).toBe(".saw/reviews/x.md");
});

test("review_session: only a session saw ran counts, and its latest verdict decides", () => {
  const dir = project("review_session");
  const c = config(dir);
  const task = startTask(dir, "standard", "feature");
  expect(reviewEvidence(dir, c, task, "code_review", "pass", saved(dir, "cr.md", PASS)).problem).toContain("not --report");
  recordReview(dir, "feature", "x", "both", PASS); // review-session record: self-attested
  expect(reviewEvidence(dir, c, task, "code_review", "pass").problem).toContain("no review report");
  recordReview(dir, "feature", "x", "both", PASS, new Date(), "ran");
  expect(reviewEvidence(dir, c, task, "code_review", "pass").report).toBe(".saw/reviews/x.md");
  recordReview(dir, "feature", "x", "both", "verdict: fail\n", new Date(Date.now() + 1000), "ran");
  expect(reviewEvidence(dir, c, task, "code_review", "pass").problem).toContain("verdict: fail");
});

test("saw task record refuses an unbacked pass and links the report in saw task report", () => {
  const dir = project("agent");
  expect(run(["task", "start", "--tier", "standard", "--playbook", "feature"], dir)).toBe(0);
  expect(run(["task", "record", "code_review", "pass"], dir)).toBe(1);
  const report = saved(dir, "code_review.md", PASS);
  expect(run(["task", "record", "code_review", "pass", "--report", report, "--note", "2 nits"], dir)).toBe(0);
  expect(taskReport(dir, config(dir), currentTask(dir)!)).toContain("`code_review` (2 nits; report: `.saw/reviews/code_review.md`)");
});
