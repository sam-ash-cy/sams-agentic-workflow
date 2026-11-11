import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { lintContext } from "../src/lint";
import { runCheck, tail } from "../src/run";
import { endTask, gate, gitStatusHash, markUntaskedEdit, storeTreeHash, recordCheck, requiredChecks, startTask, taskStatus, writeStatusFile } from "../src/task";
import { routerNudge } from "../src/context";
import { pluginProblem } from "../src/main";

function project(toml = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "saw-task-"));
  writeFileSync(join(dir, "workflow.toml"), toml);
  return dir;
}

const config = (dir: string) => resolve(dir, {}, { global: join(dir, "none.toml"), project: join(dir, "workflow.toml"), local: join(dir, "none.toml") }).config;

test("required checks follow extends", () => {
  const c = config(project());
  expect(requiredChecks(c, "trivial")).toEqual(["test"]);
  expect(requiredChecks(c, "complex")).toEqual(requiredChecks(c, "standard"));
  expect(requiredChecks(c, "critical")).toContain("threat_model");
  expect(requiredChecks(c, "critical")).toContain("security_review");
});

test("gate blocks until required checks pass in this task", () => {
  const dir = project('[checks]\ntest = "echo ok"\n[verify]\nallow_unconfigured = ["lint"]\n[verify.standard]\nrun = ["test", "code_review", "lint"]');
  const c = config(dir);
  expect(gate(dir, c, {})).toBeUndefined(); // no task open

  recordCheck(dir, { name: "test", status: "pass", how: "ran" }); // before the task: doesn't count
  startTask(dir, "standard", "feature");
  const blocked = gate(dir, c, {});
  expect(blocked?.decision).toBe("block");
  expect(blocked?.reason).toContain("not run: test, code_review");
  expect(gate(dir, c, { stop_hook_active: true })).toBeUndefined();

  recordCheck(dir, { name: "test", status: "fail", how: "ran" });
  expect(taskStatus(dir, c, { tier: "standard", playbook: "feature", started: "", from: 1 }).label).toBe("Blocked");
  recordCheck(dir, { name: "test", status: "pass", how: "ran" });
  expect(gate(dir, c, {})?.reason).toContain("Partially verified");
  recordCheck(dir, { name: "code_review", status: "pass", how: "recorded" });
  expect(gate(dir, c, {})).toBeUndefined(); // lint has no command, but verify.allow_unconfigured waives it
  expect(taskStatus(dir, c, { tier: "standard", playbook: "feature", started: "", from: 1 }).waived).toEqual(["lint"]);
});

test("a recorded result cannot stand in for a mechanical check", () => {
  const dir = project('[checks]\ntest = "echo ok"\n[verify.standard]\nrun = ["test"]');
  const c = config(dir);
  startTask(dir, "standard", "feature");
  recordCheck(dir, { name: "test", status: "pass", how: "recorded" });
  expect(gate(dir, c, {})?.reason).toContain("not run: test");
});

test("evidence still counts after checks.jsonl is truncated mid-task", () => {
  const dir = project('[checks]\ntest = "echo ok"\n[verify.standard]\nrun = ["test"]');
  for (let i = 0; i < 3; i++) recordCheck(dir, { name: "old", status: "pass", how: "ran" });
  startTask(dir, "standard", "feature");
  writeFileSync(join(dir, ".saw", "checks.jsonl"), "");
  recordCheck(dir, { name: "test", status: "pass", how: "ran" });
  expect(gate(dir, config(dir), {})).toBeUndefined();
});

test("gate is off when verify_hook is disabled", () => {
  const dir = project("[features]\nverify_hook = false");
  startTask(dir, "standard", "feature");
  expect(gate(dir, config(dir), {})).toBeUndefined();
});

test("saw run records results and keeps output quiet", () => {
  const dir = project('[checks]\nok = "echo hello"\nbad = "echo boom && exit 3"');
  const c = config(dir);
  startTask(dir, "trivial", "feature");
  expect(runCheck(dir, c, "ok")).toMatchObject({ code: 0, shown: "" });
  const bad = runCheck(dir, c, "bad");
  expect(bad.code).toBe(3);
  expect(bad.shown).toContain("boom");
  expect(() => runCheck(dir, c, "missing")).toThrow("no command");
  expect(tail("1\n2\n3\n4", 2)).toBe("… 2 lines hidden (full log below)\n3\n4");
});

test("context lint enforces line limits", () => {
  const dir = project("[context]\nagents_md_max_lines = 2");
  writeFileSync(join(dir, "AGENTS.md"), "a\nb\nc\n");
  expect(lintContext(dir, config(dir))[0]).toContain("AGENTS.md has 3 lines (max 2)");
});

test("gate blocks edits made with no task open, once per stop", () => {
  const dir = project();
  const c = config(dir);
  markUntaskedEdit(dir);
  expect(gate(dir, c, {})?.reason).toContain("no saw task is open");
  expect(gate(dir, c, { stop_hook_active: true })).toBeUndefined();
  startTask(dir, "trivial", "feature"); // opening a task clears the marker
  endTask(dir);
  expect(gate(dir, c, {})).toBeUndefined();
});

test("edits outside the project don't arm its Stop gate", () => {
  const dir = project();
  const c = config(dir);
  markUntaskedEdit(dir, join(dir, "..", "other-repo", "a.ts"));
  markUntaskedEdit(dir, join(tmpdir(), "elsewhere", "b.ts"));
  expect(gate(dir, c, {})).toBeUndefined();
  markUntaskedEdit(dir, join(dir, "src", "a.ts"));
  expect(gate(dir, c, {})?.reason).toContain("no saw task is open");
});

test("untasked edits are ignored outside a saw project", () => {
  const dir = mkdtempSync(join(tmpdir(), "saw-plain-"));
  markUntaskedEdit(dir);
  expect(existsSync(join(dir, ".saw"))).toBe(false);
});

test("router nudge fires only in a saw project with no task", () => {
  const dir = project();
  const c = config(dir);
  expect(JSON.stringify(routerNudge(dir, c))).toContain("router skill");
  startTask(dir, "standard", "feature");
  expect(routerNudge(dir, c)).toBeUndefined();
  expect(routerNudge(mkdtempSync(join(tmpdir(), "saw-plain-")), c)).toBeUndefined();
});

test("doctor reads the plugin list", () => {
  const ok = "Installed plugins:\n\n  ❯ sams-agentic-workflow@sams-agentic-workflow\n    Version: 0.1.0\n    Status: ✔ enabled\n\n  ❯ other@x\n    Status: ✘ disabled\n";
  expect(pluginProblem(ok)).toBeUndefined();
  expect(pluginProblem("Installed plugins:\n\n  ❯ other@x\n    Status: ✔ enabled\n")).toContain("not installed");
  expect(pluginProblem("  ❯ sams-agentic-workflow@sams-agentic-workflow\n    Status: ✘ disabled\n\n  ❯ other@x\n    Status: ✔ enabled\n")).toContain("disabled");
});

function gitProject(): string {
  const dir = project();
  spawnSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

test("gate blocks once for a shell write that changed the working tree", () => {
  const dir = gitProject();
  const c = config(dir);
  storeTreeHash(dir, "s1", gitStatusHash(dir)!);
  expect(gate(dir, c, { session_id: "s1" })).toBeUndefined(); // nothing changed
  writeFileSync(join(dir, "made-by-sed.txt"), "x");
  expect(gate(dir, c, { session_id: "s1" })?.reason).toContain("saw task adhoc");
  expect(gate(dir, c, { session_id: "s1" })).toBeUndefined(); // once per change
  writeFileSync(join(dir, "again.txt"), "y");
  expect(gate(dir, c, { session_id: "s1" })?.decision).toBe("block");
});

test("the shell-write check stays quiet without a baseline, session, git repo or saw project", () => {
  const dir = gitProject();
  const c = config(dir);
  writeFileSync(join(dir, "a.txt"), "x");
  expect(gate(dir, c, { session_id: "no-baseline" })).toBeUndefined();
  expect(gate(dir, c, {})).toBeUndefined();
  storeTreeHash(dir, "s2", "stale");
  const plain = mkdtempSync(join(tmpdir(), "saw-task-"));
  writeFileSync(join(plain, "workflow.toml"), "");
  storeTreeHash(plain, "s2", "stale");
  expect(gate(plain, config(plain), { session_id: "s2" })).toBeUndefined(); // not a git repo
  const noSaw = mkdtempSync(join(tmpdir(), "saw-task-"));
  spawnSync("git", ["init", "-q"], { cwd: noSaw });
  storeTreeHash(noSaw, "s2", "stale");
  writeFileSync(join(noSaw, "a.txt"), "x");
  expect(gate(noSaw, c, { session_id: "s2" })).toBeUndefined(); // not a saw project
});

test("an open task or an edit-hook marker keeps the old behaviour; a reported marker is not reported again", () => {
  const dir = gitProject();
  const c = config(dir);
  storeTreeHash(dir, "s3", gitStatusHash(dir)!);
  writeFileSync(join(dir, "a.txt"), "x");
  markUntaskedEdit(dir, join(dir, "a.txt"));
  expect(gate(dir, c, { session_id: "s3" })?.decision).toBe("block");
  expect(gate(dir, c, { session_id: "s3" })).toBeUndefined();
  startTask(dir, "trivial", "feature");
  writeFileSync(join(dir, "b.txt"), "y");
  expect(gate(dir, c, { session_id: "s3" })?.reason ?? "").not.toContain("no saw task is open");
});

test("router nudge needs verify_hook, a saw project and no open task", () => {
  const dir = project();
  expect(JSON.stringify(routerNudge(dir, config(dir)))).toContain("router skill");
  expect(routerNudge(dir, config(project("[features]\nverify_hook = false\n")))).toBeUndefined();
  startTask(dir, "trivial", "feature");
  expect(routerNudge(dir, config(dir))).toBeUndefined();
});

test("status.json carries the open task's tier, playbook and label for the mods, and goes with the task", () => {
  const dir = project('[checks]\ntest = "echo ok"');
  const c = config(dir);
  const task = startTask(dir, "trivial", "debug");
  writeStatusFile(dir, c);
  const s = JSON.parse(readFileSync(join(dir, ".saw", "status.json"), "utf8"));
  expect(s).toEqual({ started: task.started, tier: "trivial", playbook: "debug", label: "Not verified" });
  endTask(dir);
  expect(existsSync(join(dir, ".saw", "status.json"))).toBe(false);
  writeStatusFile(dir, c);
  expect(existsSync(join(dir, ".saw", "status.json"))).toBe(false);
});

test("acceptance criteria keep a task from Verified until each passes", () => {
  const dir = project('[checks]\ntest = "echo ok"\n[verify.trivial]\nrun = ["test"]');
  const c = config(dir);
  const t = startTask(dir, "trivial", "feature", undefined, ["shows the label", "keeps old tasks"]);
  expect(t.accept).toEqual(["shows the label", "keeps old tasks"]);
  recordCheck(dir, { name: "test", status: "pass", how: "ran" });
  let s = taskStatus(dir, c, t);
  expect(s.label).toBe("Partially verified");
  expect(gate(dir, c, {})?.reason).toContain("accept:1 not recorded; accept:2 not recorded");
  recordCheck(dir, { name: "accept:1", status: "pass", how: "recorded", note: "task.test.ts" });
  recordCheck(dir, { name: "accept:2", status: "fail", how: "recorded" });
  s = taskStatus(dir, c, t);
  expect(s.label).toBe("Blocked");
  expect(gate(dir, c, {})?.reason).toContain("accept:2 failed");
  recordCheck(dir, { name: "accept:2", status: "pass", how: "recorded", note: "bun test" });
  expect(gate(dir, c, {})).toBeUndefined();
  expect(taskStatus(dir, c, t).acceptance?.map((a) => a.result)).toEqual(["pass", "pass"]);
});

test("a task with no criteria has no acceptance in its status", () => {
  const dir = project('[checks]\ntest = "echo ok"\n[verify.trivial]\nrun = ["test"]');
  const t = startTask(dir, "trivial", "feature");
  expect(t.accept).toBeUndefined();
  recordCheck(dir, { name: "test", status: "pass", how: "ran" });
  const s = taskStatus(dir, config(dir), t);
  expect(s.label).toBe("Verified");
  expect(s.acceptance).toBeUndefined();
});
