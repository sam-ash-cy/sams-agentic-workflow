import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { lintContext } from "../src/lint";
import { runCheck, tail } from "../src/run";
import { gate, recordCheck, requiredChecks, startTask, taskStatus } from "../src/task";

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
  const dir = project('[checks]\ntest = "echo ok"\n[verify.standard]\nrun = ["test", "code_review", "lint"]');
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
  expect(gate(dir, c, {})).toBeUndefined(); // lint has no command: reported, not blocking
  expect(taskStatus(dir, c, { tier: "standard", playbook: "feature", started: "", from: 1 }).unconfigured).toEqual(["lint"]);
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
