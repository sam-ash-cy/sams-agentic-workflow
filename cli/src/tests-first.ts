// features.tdd with [tdd] mode = "hard": on a standard-or-higher task in one of
// [tdd].playbooks, saw guard denies edits to code files (tests excepted) until
// `saw run test` has failed since the task started: the failing tests from the
// plan come first. Needs [checks].test; without it the guard stays out.

import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Table } from "./defaults";
import { checkResults, currentTask, tddSettings } from "./task";

const CODE = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".py", ".go", ".rs", ".php", ".rb", ".java", ".kt", ".swift", ".cs", ".c", ".cc", ".cpp", ".h", ".hpp", ".dart", ".ex", ".exs", ".scala"]);
const TEST_DIR = /(^|\/)(tests?|__tests__|spec|specs|e2e|testdata|fixtures)\//;
const TEST_NAME = /(\.|_|-)(test|spec)\.[a-z]+$|^test_[^/]*\.py$|Tests?\.(java|kt|cs|swift)$/;

export function isTestFile(rel: string): boolean {
  const p = rel.split(sep).join("/");
  return TEST_DIR.test(p) || TEST_NAME.test(p.split("/").pop() ?? "");
}

// A test run has failed since the task started (the red step).
export const sawRed = (cwd: string, from: number): boolean => checkResults(cwd, from).some((r) => r.name === "test" && r.status === "fail" && r.how === "ran");

export function testsFirstEdit(config: Table, filePath: string | undefined, cwd: string): { decision: "deny"; reason: string } | undefined {
  const s = tddSettings(config);
  if (!s.hard || !filePath) return undefined;
  if (!((config.checks ?? {}) as Record<string, unknown>).test) return undefined;
  const rel = relative(resolve(cwd), resolve(cwd, filePath));
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  if (!CODE.has(extname(rel).toLowerCase()) || isTestFile(rel)) return undefined;
  const task = currentTask(cwd);
  if (!task || task.tier === "trivial" || !s.playbooks.includes(task.playbook)) return undefined;
  if (sawRed(cwd, task.from)) return undefined;
  return { decision: "deny", reason: `tdd: tests first. Write the failing tests from the plan, run \`saw run test\` and see it fail, then edit ${rel} (or set tdd.mode soft)` };
}
