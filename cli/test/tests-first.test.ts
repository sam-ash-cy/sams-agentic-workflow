import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { guardHook } from "../src/guard";
import { recordCheck, startTask, taskSteps } from "../src/task";
import { isTestFile, testsFirstEdit } from "../src/tests-first";

function config(toml = ""): ReturnType<typeof resolve>["config"] {
  const dir = mkdtempSync(join(tmpdir(), "saw-tf-"));
  writeFileSync(join(dir, "workflow.toml"), toml);
  const none = join(dir, "none.toml");
  return resolve(dir, {}, { global: none, project: none, local: join(dir, "workflow.toml") }).config;
}
const WITH_TEST = '[checks]\ntest = "bun test"\n[tdd]\nmode = "hard"\n';

test("isTestFile knows the usual test layouts", () => {
  for (const f of ["cli/test/a.test.ts", "src/a.spec.tsx", "tests/test_x.py", "pkg/x_test.go", "__tests__/a.js", "src/FooTest.java"]) expect(isTestFile(f)).toBe(true);
  for (const f of ["src/a.ts", "cli/src/testing.ts", "app/Models/User.php"]) expect(isTestFile(f)).toBe(false);
});

test("code edits wait for a failing test run; tests, docs and other tiers don't", () => {
  const c = config(WITH_TEST);
  const cwd = mkdtempSync(join(tmpdir(), "saw-tf-"));
  const src = join(cwd, "src", "a.ts");
  expect(testsFirstEdit(c, src, cwd)).toBeUndefined(); // no task
  startTask(cwd, "standard", "feature");
  expect(testsFirstEdit(c, src, cwd)?.reason).toContain("saw run test");
  expect(testsFirstEdit(c, join(cwd, "src", "a.test.ts"), cwd)).toBeUndefined();
  expect(testsFirstEdit(c, join(cwd, "README.md"), cwd)).toBeUndefined();
  expect(testsFirstEdit(c, join(tmpdir(), "elsewhere.ts"), cwd)).toBeUndefined();
  recordCheck(cwd, { name: "test", status: "pass", how: "ran" });
  expect(testsFirstEdit(c, src, cwd)?.decision).toBe("deny"); // green isn't red
  recordCheck(cwd, { name: "test", status: "fail", how: "ran" });
  expect(testsFirstEdit(c, src, cwd)).toBeUndefined();

  const spike = mkdtempSync(join(tmpdir(), "saw-tf-"));
  startTask(spike, "standard", "spike");
  expect(testsFirstEdit(c, join(spike, "a.ts"), spike)).toBeUndefined();
  const trivial = mkdtempSync(join(tmpdir(), "saw-tf-"));
  startTask(trivial, "trivial", "feature");
  expect(testsFirstEdit(c, join(trivial, "a.ts"), trivial)).toBeUndefined();
});

test("soft mode, tdd off, or no test command leave edits alone", () => {
  const cwd = mkdtempSync(join(tmpdir(), "saw-tf-"));
  startTask(cwd, "standard", "feature");
  const f = join(cwd, "a.ts");
  expect(testsFirstEdit(config('[checks]\ntest = "bun test"\n[tdd]\nmode = "soft"\n'), f, cwd)).toBeUndefined();
  // soft is the default: no [tdd] table leaves edits alone too.
  expect(testsFirstEdit(config('[checks]\ntest = "bun test"\n'), f, cwd)).toBeUndefined();
  expect(testsFirstEdit(config(WITH_TEST + "[features]\ntdd = false\n"), f, cwd)).toBeUndefined();
  expect(testsFirstEdit(config(), f, cwd)).toBeUndefined();
});

test("saw guard denies the edit and the step says tests first", () => {
  const c = config(WITH_TEST);
  const cwd = mkdtempSync(join(tmpdir(), "saw-tf-"));
  startTask(cwd, "standard", "feature");
  const out = guardHook(c, { tool_name: "Edit", tool_input: { file_path: join(cwd, "a.ts") } }, cwd) as { hookSpecificOutput?: { permissionDecision?: string } } | undefined;
  expect(out?.hookSpecificOutput?.permissionDecision).toBe("deny");
  expect(taskSteps(c, "standard", "feature").join(" ")).toContain("tests first");
  expect(taskSteps(config(), "standard", "feature").join(" ")).toContain("tdd (failing test first)");
});
