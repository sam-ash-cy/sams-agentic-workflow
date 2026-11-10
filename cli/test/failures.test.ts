import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failingTests, failureCandidates, priorFailures, recordFailures } from "../src/failures";
import { retro } from "../src/retro";

test("failing test names come out of bun, jest/vitest, pytest, go and phpunit output", () => {
  const out = [
    "(fail) cost band warns once [23.85ms]",
    "(pass) fine [1ms]",
    "  ✕ renders the header (12 ms)",
    "  × vitest thing 4ms",
    "FAILED tests/test_api.py::test_login - AssertionError",
    "--- FAIL: TestParse (0.00s)",
    "1) Tests\UserTest::testName",
  ].join("\n");
  expect(failingTests(out)).toEqual([
    "cost band warns once",
    "renders the header",
    "vitest thing",
    "tests/test_api.py::test_login",
    "TestParse",
    "Tests\UserTest::testName",
  ]);
});

test("names repeat only once per run, and output with none gives none", () => {
  expect(failingTests("(fail) a [1ms]\n(fail) a [2ms]")).toEqual(["a"]);
  expect(failingTests("error: something broke")).toEqual([]);
});

test("a test failing in two tasks is a candidate; one task twice is not", () => {
  const cwd = mkdtempSync(join(tmpdir(), "saw-fail-"));
  recordFailures(cwd, "test", ["flaky one", "solo"], "2026-11-01T00:00:00Z");
  recordFailures(cwd, "test", ["solo"], "2026-11-01T00:00:00Z");
  recordFailures(cwd, "test", ["flaky one"], "2026-11-02T00:00:00Z");
  const c = failureCandidates(cwd, 2);
  expect(c.map((x) => x.check)).toEqual(["test: flaky one"]);
  expect(c[0]!.tasks).toBe(2);
  expect(c[0]!.failures).toBe(2);
  expect(priorFailures(cwd, "test", ["flaky one", "solo", "new"], "2026-11-03T00:00:00Z")).toEqual([{ test: "flaky one", tasks: 2 }, { test: "solo", tasks: 1 }]);
});

test("saw retro writes a proposal for a recurring test", () => {
  const cwd = mkdtempSync(join(tmpdir(), "saw-fail-"));
  recordFailures(cwd, "test", ["login works"], "2026-11-01T00:00:00Z");
  recordFailures(cwd, "test", ["login works"], "2026-11-02T00:00:00Z");
  const dir = join(cwd, "proposals");
  const r = retro(dir, [], 2, true, "2026-11-10", failureCandidates(cwd, 2));
  expect(r.written).toEqual(["0001-test-login-works.md"]);
  expect(readFileSync(join(dir, readdirSync(dir)[0]!), "utf8")).toContain("check: test: login works");
});

test("saw run logs failing tests and names ones that failed in an earlier task", () => {
  const { writeFileSync } = require("node:fs");
  const { resolve } = require("../src/config");
  const { runCheck } = require("../src/run");
  const { endTask, startTask } = require("../src/task");
  const cwd = mkdtempSync(join(tmpdir(), "saw-fail-"));
  writeFileSync(join(cwd, "workflow.toml"), `[checks]\ntest = "echo '(fail) login works [1ms]'; exit 1"\n`);
  const config = resolve(cwd, {}, { global: join(cwd, "none.toml"), project: join(cwd, "workflow.toml"), local: join(cwd, "none.toml") }).config;
  startTask(cwd, "standard", "feature");
  const first = runCheck(cwd, config, "test");
  expect(first.shown).not.toContain("failed before");
  endTask(cwd);
  Bun.sleepSync(5);
  startTask(cwd, "standard", "feature");
  const second = runCheck(cwd, config, "test");
  expect(second.shown).toContain("failed before, in earlier tasks: login works (1)");
  expect(failureCandidates(cwd, 2).map((c) => c.check)).toEqual(["test: login works"]);
});
