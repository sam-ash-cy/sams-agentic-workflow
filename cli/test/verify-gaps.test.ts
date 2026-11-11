// The holes a pre-release smoke test found: a task closed below its tier floor,
// commits after the task closed, unconfigured checks counting as passed, and
// saw task end with nothing open.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { guardCommand, guardHook } from "../src/guard";
import { run } from "../src/main";
import { readMetrics } from "../src/metrics";
import { noChecksWarning, recordCheck, startTask, takeUnverifiedExit, taskStatus, unverifiedChanges } from "../src/task";

const CHECKS = '[checks]\ntest = "exit 0"\n';

const git = (cwd: string, ...args: string[]): void => {
  Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
};

// A saw project that is also a git repo with one commit; workflow.toml is the project layer.
function repo(toml = CHECKS): string {
  const cwd = mkdtempSync(join(tmpdir(), "saw-gaps-"));
  writeFileSync(join(cwd, "workflow.toml"), toml);
  writeFileSync(join(cwd, "a.ts"), "export const a = 1;\n");
  git(cwd, "init", "-q");
  git(cwd, "config", "user.email", "t@example.com");
  git(cwd, "config", "user.name", "t");
  git(cwd, "config", "commit.gpgsign", "false");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "init");
  return cwd;
}

// The project's config, plus an extra layer outside the repo (so it isn't a change in the tree).
const config = (cwd: string, extra = ""): ReturnType<typeof resolve>["config"] => {
  const outside = mkdtempSync(join(tmpdir(), "saw-gaps-layer-"));
  const none = join(outside, "none.toml");
  const local = join(outside, "extra.toml");
  writeFileSync(local, extra);
  return resolve(cwd, {}, { global: none, project: join(cwd, "workflow.toml"), local }).config;
};

const decision = (out: Record<string, unknown> | undefined): string | undefined => (out?.hookSpecificOutput as { permissionDecision?: string } | undefined)?.permissionDecision;
const reason = (out: Record<string, unknown> | undefined): string => String((out?.hookSpecificOutput as { permissionDecisionReason?: string } | undefined)?.permissionDecisionReason ?? "");
const bash = (c: ReturnType<typeof config>, cwd: string, command: string) => guardHook(c, { tool_name: "Bash", tool_input: { command } }, cwd);
const pass = (cwd: string, name = "test"): void => recordCheck(cwd, { name, status: "pass", how: "ran" });

test("1: a task below its tier floor is Not verified, needs --reason to end, and its metric says so", () => {
  const cwd = repo();
  const c = config(cwd);
  const task = startTask(cwd, "trivial", "feature");
  mkdirSync(join(cwd, "src", "auth"), { recursive: true });
  writeFileSync(join(cwd, "src", "auth", "login.ts"), "export const login = 1;\n");
  pass(cwd);
  const s = taskStatus(cwd, c, task);
  expect(s.label).toBe("Not verified");
  expect(s.floor).toContain("critical");
  expect(run(["task", "end"], cwd)).toBe(1);
  expect(run(["task", "end", "--reason", "x"], cwd)).toBe(0);
  expect(readMetrics(cwd).pop()?.label).toBe("Not verified");
  expect(takeUnverifiedExit(cwd)?.label).toBe("Not verified");
  // Not Verified: nothing recorded as verified, so the change stays uncovered.
  expect(unverifiedChanges(cwd)).toContain("src/auth/login.ts");
});

test("1: a task at or above its floor with its checks run still ends Verified", () => {
  const cwd = repo();
  startTask(cwd, "trivial", "feature");
  writeFileSync(join(cwd, "a.ts"), "export const a = 2;\n");
  pass(cwd);
  expect(run(["task", "end"], cwd)).toBe(0);
  expect(readMetrics(cwd).pop()?.label).toBe("Verified");
});

test("2: hard, no task open: a commit is denied until a Verified task covers the change", () => {
  const cwd = repo();
  const c = config(cwd);
  // A clean tree passes.
  expect(decision(bash(c, cwd, "git commit -m x"))).not.toBe("deny");
  writeFileSync(join(cwd, "a.ts"), "export const a = 2;\n");
  for (const cmd of ["git commit -am x", "git push origin main", "gh pr create --fill"]) {
    const out = bash(c, cwd, cmd);
    expect(decision(out)).toBe("deny");
    expect(reason(out)).toContain("no saw task is open");
    expect(reason(out)).toContain("a.ts");
  }
  // Soft mode (or the verify hook off) leaves it to the other rules, as before.
  expect(decision(bash(config(cwd, '[verify]\nmode = "soft"\n'), cwd, "git commit -am x"))).not.toBe("deny");
  expect(decision(bash(config(cwd, "[features]\nverify_hook = false\n"), cwd, "git commit -am x"))).not.toBe("deny");
});

test("2: a normal flow (Verified -> end -> add -> commit -> push -> PR) is not blocked", () => {
  const cwd = repo();
  const c = config(cwd);
  startTask(cwd, "trivial", "feature");
  writeFileSync(join(cwd, "a.ts"), "export const a = 2;\n");
  writeFileSync(join(cwd, "b.ts"), "export const b = 1;\n");
  pass(cwd);
  expect(run(["task", "end"], cwd)).toBe(0);
  expect(decision(bash(c, cwd, "git commit -am x"))).not.toBe("deny");
  // Staging doesn't change what was verified.
  git(cwd, "add", "-A");
  expect(decision(bash(c, cwd, "git commit -m x"))).not.toBe("deny");
  git(cwd, "commit", "-q", "-m", "x");
  // Push is autonomy "never" by default: only the verify guard's own denial matters here.
  for (const cmd of ["git push origin main", "gh pr create --fill"]) expect(reason(bash(c, cwd, cmd))).not.toContain("verify:");
  // An edit after the Verified close is not covered.
  writeFileSync(join(cwd, "b.ts"), "export const b = 2;\n");
  expect(decision(bash(c, cwd, "git commit -am y"))).toBe("deny");
  // Nor is a new file.
  git(cwd, "checkout", "-q", "--", "b.ts");
  writeFileSync(join(cwd, "c.ts"), "x\n");
  expect(reason(bash(c, cwd, "git commit -am y"))).toContain("c.ts");
});

test("2: a partial commit of a Verified tree leaves the rest covered", () => {
  const cwd = repo();
  const c = config(cwd);
  startTask(cwd, "trivial", "feature");
  writeFileSync(join(cwd, "a.ts"), "export const a = 2;\n");
  writeFileSync(join(cwd, "b.ts"), "export const b = 1;\n");
  pass(cwd);
  expect(run(["task", "end"], cwd)).toBe(0);
  git(cwd, "commit", "-q", "-am", "a only");
  expect(reason(bash(c, cwd, "git push origin main"))).not.toContain("verify:");
});

test("3: a required check with no command is Not verified unless verify.allow_unconfigured lists it", () => {
  const cwd = repo("");
  const task = startTask(cwd, "trivial", "feature");
  const s = taskStatus(cwd, config(cwd), task);
  expect(s.label).toBe("Not verified");
  expect(s.unconfigured).toEqual(["test"]);
  const waived = taskStatus(cwd, config(cwd, '[verify]\nallow_unconfigured = ["test"]\n'), task);
  expect(waived.label).toBe("Verified");
  expect(waived.waived).toEqual(["test"]);
  expect(run(["task", "end"], cwd)).toBe(1);
});

test("3: a project with no [checks] commands gets a warning naming how to set one", () => {
  const cwd = repo("");
  expect(noChecksWarning(config(cwd))).toContain("saw config set checks.test");
  expect(noChecksWarning(config(cwd, CHECKS))).toBeUndefined();
  // The agent can't waive checks for itself without asking.
  expect(guardCommand(config(cwd), `saw config set verify.allow_unconfigured '["test"]'`, cwd)?.decision).toBe("ask");
});

test("4: saw task end with no task open fails like saw task status", () => {
  const cwd = repo();
  expect(run(["task", "end"], cwd)).toBe(1);
  expect(run(["task", "status"], cwd)).toBe(1);
});

test("2: a file name git would quote can't dodge the comparison", () => {
  const cwd = repo();
  const c = config(cwd);
  startTask(cwd, "trivial", "feature");
  writeFileSync(join(cwd, "café.ts"), "export const a = 1;\n");
  pass(cwd);
  expect(run(["task", "end"], cwd)).toBe(0);
  expect(decision(bash(c, cwd, "git commit -am x"))).not.toBe("deny");
  writeFileSync(join(cwd, "café.ts"), "export const a = 2;\n");
  expect(reason(bash(c, cwd, "git commit -am x"))).toContain("café.ts");
});

test("2: a sub-project's guard sees changes elsewhere in the repository", () => {
  const cwd = repo();
  mkdirSync(join(cwd, "app"));
  writeFileSync(join(cwd, "app", "workflow.toml"), CHECKS);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "app");
  writeFileSync(join(cwd, "a.ts"), "export const a = 3;\n");
  const sub = join(cwd, "app");
  expect(reason(bash(config(sub), sub, "git commit -am x"))).toContain("a.ts");
});

test("3: the warning names unset trivial checks even when dep_audit is set, and respects allow_unconfigured", () => {
  const cwd = repo('[checks]\ndep_audit = "bun audit"\n');
  expect(noChecksWarning(config(cwd))).toContain("checks.test");
  expect(noChecksWarning(config(cwd, '[verify]\nallow_unconfigured = ["test"]\n'))).toBeUndefined();
});

test("4: a bad --tokens fails before anything is recorded", () => {
  const cwd = repo();
  startTask(cwd, "trivial", "feature");
  writeFileSync(join(cwd, "a.ts"), "export const a = 2;\n");
  expect(run(["task", "end", "--reason", "x", "--tokens", "abc"], cwd)).toBe(1);
  expect(takeUnverifiedExit(cwd)).toBeUndefined();
});
