// `saw run <check>`: run a configured check with quiet output. Only the tail
// of a failure is printed; the full log goes to output.full_logs.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inside } from "./config";
import type { Table } from "./defaults";
import { failingTests, priorFailures, recordFailures } from "./failures";
import { currentTask, recordCheck } from "./task";

export interface RunResult {
  code: number;
  shown: string;
  log: string;
}

export function tail(text: string, maxLines: number): string {
  const lines = text.trimEnd().split(/\r?\n/);
  if (lines.length <= maxLines) return lines.join("\n");
  return [`… ${lines.length - maxLines} lines hidden (full log below)`, ...lines.slice(-maxLines)].join("\n");
}

const TEST_FILE = /(^|\/)(test_[^/]+|[^/]+[._-](test|spec)\.[^/]+|[^/]+Test\.[^/]+)$/;

// The stem a test file covers: foo.test.ts, foo.spec.js, test_foo.py, foo_test.go, FooTest.php → foo/Foo.
const stem = (path: string): string =>
  path.split("/").pop()!.replace(/\.[^.]+$/, "").replace(/^test_/, "").replace(/([._-](test|spec)|Test)$/, "");

// Tests for the files changed since HEAD (plus untracked), by naming
// convention: a changed test runs itself; a changed source file runs the tests
// sharing its stem. Empty: nothing maps, so the caller runs the full suite.
export function changedTests(changed: string[], tracked: string[]): string[] {
  const tests = tracked.filter((f) => TEST_FILE.test(f));
  const out = new Set<string>();
  for (const f of changed) {
    if (TEST_FILE.test(f)) out.add(f);
    else for (const t of tests) if (stem(t) === stem(f)) out.add(t);
  }
  return [...out].sort();
}

function gitLines(cwd: string, args: string[]): string[] {
  const p = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return p.exitCode === 0 ? p.stdout.toString().split("\n").map((l) => l.trim()).filter(Boolean) : [];
}

// A file path is passed to the shell as an argument: allow only plain path characters.
const SAFE_PATH = /^[\w./@+-]+$/;

export function runCheck(cwd: string, config: Table, name: string, opts: { changed?: boolean } = {}): RunResult {
  let command = ((config.checks ?? {}) as Record<string, string>)[name];
  if (!command) throw new Error(`no command for check "${name}"; set it with: saw config set checks.${name} "<command>"`);
  const base = command;
  if (opts.changed) {
    const changed = [...gitLines(cwd, ["diff", "--name-only", "HEAD"]), ...gitLines(cwd, ["ls-files", "--others", "--exclude-standard"])];
    const tests = changedTests(changed, [...gitLines(cwd, ["ls-files"]), ...changed]).filter((f) => SAFE_PATH.test(f) && existsSync(join(cwd, f)));
    if (tests.length) command = `${command} ${tests.join(" ")}`;
  }
  const output = (config.output ?? {}) as { quiet?: boolean; max_lines?: number; full_logs?: string };
  // A committed workflow.toml must not make saw write outside the project.
  const logDir = inside(cwd, output.full_logs ?? ".saw/logs");
  if (!logDir) throw new Error("output.full_logs must be a path inside the project");

  // One syntax everywhere: checks are written for sh (CI runs them on Linux), so
  // Windows uses Git Bash's sh when it's on PATH and falls back to cmd.
  const shell = process.platform !== "win32" || Bun.which("sh") ? ["sh", "-c", command] : ["cmd", "/c", command];
  const proc = Bun.spawnSync(shell, { cwd, stdout: "pipe", stderr: "pipe" });
  const text = proc.stdout.toString() + proc.stderr.toString();
  const code = proc.exitCode ?? 1;

  mkdirSync(logDir, { recursive: true });
  const log = join(logDir, `${name}.log`);
  writeFileSync(log, text);

  recordCheck(cwd, { name, status: code === 0 ? "pass" : "fail", how: "ran", ...(command !== base ? { note: "changed files only" } : {}) });
  const quiet = output.quiet !== false;
  let shown = code === 0 && quiet ? "" : quiet ? tail(text, output.max_lines ?? 60) : text;
  if (code !== 0) {
    // Failure memory: name the tests that failed in earlier tasks too, then log this run's.
    const tests = failingTests(text);
    const task = currentTask(cwd)?.started ?? "";
    const prior = priorFailures(cwd, name, tests, task);
    if (prior.length) shown += `
failed before, in earlier tasks: ${prior.map((p) => `${p.test} (${p.tasks})`).join(", ")}; a recurring failure needs its root cause (saw retro)`;
    recordFailures(cwd, name, tests, task);
  }
  return { code, shown, log };
}

// `saw format-hook`: PostToolUse on Edit/Write. Runs checks.format after each
// edit; silent on success, and a failure goes back to the agent to fix.
// Unlike `saw run`, nobody types this, so a command from a committed
// workflow.toml (any cloned repo) never runs: only global or local layers.
export const TRUSTED_LAYERS = ["global", "local", "override"];

export function formatHook(cwd: string, config: Table, input: { tool_name?: string }, source?: string): Record<string, unknown> | undefined {
  const features = (config.features ?? {}) as Record<string, boolean>;
  const commands = (config.checks ?? {}) as Record<string, string>;
  if (!features.format_hook || !commands.format || !["Edit", "Write", "MultiEdit"].includes(input.tool_name ?? "")) return undefined;
  if (!TRUSTED_LAYERS.includes(source ?? "")) return undefined;
  const r = runCheck(cwd, config, "format");
  if (r.code === 0) return undefined;
  return {
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: `[saw format] checks.format failed (exit ${r.code}); fix it before going on:\n${r.shown}\nfull log: ${r.log}` },
  };
}
