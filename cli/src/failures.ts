// Failure memory: `saw run` keeps the names of failing tests in
// .saw/failures.jsonl, one line per test per run, with the task it ran in.
// A test that fails across retro.repeat_threshold tasks becomes a `saw retro`
// proposal of its own, and a run that fails a test seen before says so.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Candidate } from "./retro";

interface Failure {
  check: string;
  test: string;
  task: string;
  at: string;
}

// One pattern per runner; the first group is the test's name.
const PATTERNS = [
  /^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/, // bun
  /^\s*[✕×] (.+?)(?: \(?\d+(?:\.\d+)? ?m?s\)?)?$/, // jest, vitest
  /^FAILED (\S+::\S+)/, // pytest
  /^\s*--- FAIL: (\S+)/, // go
  /^\d+\) (\S+::\w+)/, // phpunit
];

export function failingTests(output: string): string[] {
  const names = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    for (const p of PATTERNS) {
      const m = p.exec(line);
      if (m) {
        names.add(m[1]!.trim());
        break;
      }
    }
  }
  return [...names];
}

const path = (cwd: string): string => join(cwd, ".saw", "failures.jsonl");

function readFailures(cwd: string): Failure[] {
  if (!existsSync(path(cwd))) return [];
  return readFileSync(path(cwd), "utf8").split("\n").filter((l) => l.trim()).flatMap((l) => {
    try {
      return [JSON.parse(l) as Failure];
    } catch {
      return [];
    }
  });
}

// `task` is the open task's start time, or "" outside a task.
export function recordFailures(cwd: string, check: string, tests: string[], task: string): void {
  if (!tests.length) return;
  mkdirSync(join(cwd, ".saw"), { recursive: true });
  const at = new Date().toISOString();
  appendFileSync(path(cwd), tests.map((test) => JSON.stringify({ check, test, task, at })).join("\n") + "\n");
}

// Distinct tasks each (check, test) failed in; runs outside a task count as one each.
function byTest(failures: Failure[]): Map<string, { check: string; test: string; tasks: Set<string>; runs: number; last: string }> {
  const out = new Map<string, { check: string; test: string; tasks: Set<string>; runs: number; last: string }>();
  for (const f of failures) {
    const key = `${f.check}\u0000${f.test}`;
    const e = out.get(key) ?? { check: f.check, test: f.test, tasks: new Set<string>(), runs: 0, last: "" };
    e.tasks.add(f.task || f.at);
    e.runs += 1;
    if (f.at > e.last) e.last = f.at;
    out.set(key, e);
  }
  return out;
}

export function failureCandidates(cwd: string, threshold: number): Candidate[] {
  return [...byTest(readFailures(cwd)).values()]
    .filter((e) => e.tasks.size >= threshold)
    .map((e) => ({ check: `${e.check}: ${e.test}`, tasks: e.tasks.size, failures: e.runs, last: e.last }))
    .sort((a, b) => b.tasks - a.tasks || a.check.localeCompare(b.check));
}

// Of `tests`, those that failed in an earlier task than `task`, with how many.
export function priorFailures(cwd: string, check: string, tests: string[], task: string): { test: string; tasks: number }[] {
  const seen = byTest(readFailures(cwd).filter((f) => f.check === check && (f.task || f.at) !== task));
  return tests.flatMap((test) => {
    const e = seen.get(`${check}\u0000${test}`);
    return e ? [{ test, tasks: e.tasks.size }] : [];
  });
}
