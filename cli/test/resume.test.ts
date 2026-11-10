import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCard, resume, resumeHint, writeCard, type Git } from "../src/resume";
import { currentTask, endTask, recordCheck, startTask } from "../src/task";

function fakeGit(branch: string, dirty = false): { git: Git; calls: string[][] } {
  const calls: string[][] = [];
  const git: Git = (args) => {
    calls.push(args);
    if (args[0] === "branch") return { ok: true, out: branch };
    if (args[0] === "status") return { ok: true, out: dirty ? " M a.ts" : "" };
    return { ok: true, out: "" };
  };
  return { git, calls };
}

test("Stop writes a card; a new session restores task, plan and branch", () => {
  const cwd = mkdtempSync(join(tmpdir(), "saw-rs-"));
  writeFileSync(join(cwd, "workflow.toml"), "");
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  writeFileSync(join(cwd, "docs", "plans", "x.md"), "# plan");
  startTask(cwd, "standard", "feature");
  recordCheck(cwd, { name: "test", status: "pass", how: "ran" });
  recordCheck(cwd, { name: "lint", status: "fail", how: "ran" });
  const card = writeCard(cwd, fakeGit("feat/x").git)!;
  expect(card).toMatchObject({ branch: "feat/x", plan: "docs/plans/x.md", passed: ["test"], failing: ["lint"] });

  rmSync(join(cwd, ".saw", "task.json")); // new session, task gone
  expect(resumeHint(cwd)).toContain("saw resume");
  const g = fakeGit("main");
  const r = resume(cwd, g.git);
  expect(r.ok).toBe(true);
  expect(currentTask(cwd)?.tier).toBe("standard");
  expect(g.calls).toContainEqual(["switch", "feat/x"]);
  expect(r.lines.join("\n")).toContain("failing: lint");
  expect(resumeHint(cwd, "resume")).toBeUndefined(); // a resumed session keeps its context
});

test("dirty tree: resume names the branch but doesn't switch", () => {
  const cwd = mkdtempSync(join(tmpdir(), "saw-rs-"));
  startTask(cwd, "complex", "debug");
  writeCard(cwd, fakeGit("fix/y").git);
  const g = fakeGit("main", true);
  expect(resume(cwd, g.git).lines.join("\n")).toContain("git switch fix/y");
  expect(g.calls.some((c) => c[0] === "switch")).toBe(false);
});

test("no card, a different open task, and saw task end", () => {
  const cwd = mkdtempSync(join(tmpdir(), "saw-rs-"));
  expect(resume(cwd, fakeGit("main").git).ok).toBe(false);
  startTask(cwd, "standard", "feature");
  writeCard(cwd, fakeGit("feat/a").git);
  startTask(cwd, "trivial", "feature");
  expect(resume(cwd, fakeGit("feat/a").git).lines[0]).toContain("different task");
  endTask(cwd);
  expect(readCard(cwd)).toBeUndefined();
  expect(writeCard(cwd)).toBeUndefined();
});

test("the hint shows while the task is still open, but not after a compact", () => {
  const cwd = mkdtempSync(join(tmpdir(), "saw-rs-"));
  startTask(cwd, "standard", "feature");
  writeCard(cwd, fakeGit("feat/a").git);
  expect(resumeHint(cwd, "startup")).toContain("on feat/a");
  expect(resumeHint(cwd, "compact")).toBeUndefined();
  const r = resume(cwd, fakeGit("feat/a").git);
  expect(r.ok).toBe(true);
  expect(r.lines[0]).not.toContain("restored");
});
