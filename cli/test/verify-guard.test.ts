import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { guardHook } from "../src/guard";
import { run } from "../src/main";
import { routingEdit } from "../src/routing-guard";
import { sessionHook } from "../src/sessions";
import { currentTask, gate, recordCheck, retierTask, setTaskSession, staleTask, startTask, takeUnverifiedExit, tierFloor } from "../src/task";

const CHECKS = '[checks]\ntest = "exit 0"\n';

function config(toml = CHECKS): ReturnType<typeof resolve>["config"] {
  const dir = mkdtempSync(join(tmpdir(), "saw-vg-"));
  writeFileSync(join(dir, "workflow.toml"), toml);
  const none = join(dir, "none.toml");
  return resolve(dir, {}, { global: none, project: none, local: join(dir, "workflow.toml") }).config;
}

const git = (cwd: string, ...args: string[]): void => {
  Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
};

// A saw project that is also a git repo with one commit.
function repo(): string {
  const cwd = mkdtempSync(join(tmpdir(), "saw-vg-repo-"));
  writeFileSync(join(cwd, "workflow.toml"), CHECKS);
  writeFileSync(join(cwd, "a.ts"), "export const a = 1;\n");
  git(cwd, "init", "-q");
  git(cwd, "config", "user.email", "t@example.com");
  git(cwd, "config", "user.name", "t");
  git(cwd, "config", "commit.gpgsign", "false");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "init");
  return cwd;
}

const decision = (out: Record<string, unknown> | undefined): string | undefined => (out?.hookSpecificOutput as { permissionDecision?: string } | undefined)?.permissionDecision;
const reason = (out: Record<string, unknown> | undefined): string => String((out?.hookSpecificOutput as { permissionDecisionReason?: string } | undefined)?.permissionDecisionReason ?? "");
const bash = (c: ReturnType<typeof config>, cwd: string, command: string) => guardHook(c, { tool_name: "Bash", tool_input: { command } }, cwd);
const pass = (cwd: string, name = "test"): void => recordCheck(cwd, { name, status: "pass", how: "ran" });

test("hard: commit, push and gh pr create are denied while the task is not Verified, listing what is missing", () => {
  const cwd = repo();
  const c = config();
  startTask(cwd, "trivial", "feature");
  for (const cmd of ["git commit -m x", "git push origin main", "gh pr create --fill", 'bash -c "git commit -m x"', "git -C . push"]) {
    const out = bash(c, cwd, cmd);
    expect(decision(out)).toBe("deny");
    expect(reason(out)).toContain("not run: test");
  }
  recordCheck(cwd, { name: "test", status: "fail", how: "ran" });
  expect(reason(bash(c, cwd, "git commit -m x"))).toContain("failed: test");
});

test("a Verified task, no task, soft mode and verify_hook off leave commits to the existing rules", () => {
  const cwd = repo();
  const c = config();
  expect(decision(bash(c, cwd, "git commit -m x"))).not.toBe("deny");
  startTask(cwd, "trivial", "feature");
  expect(decision(bash(config('[verify]\nmode = "soft"\n' + CHECKS), cwd, "git commit -m x"))).not.toBe("deny");
  expect(decision(bash(config("[features]\nverify_hook = false\n" + CHECKS), cwd, "git commit -m x"))).not.toBe("deny");
  expect(decision(bash(c, cwd, 'echo "run git push later"'))).not.toBe("deny");
  expect(decision(bash(c, cwd, "git status"))).not.toBe("deny");
  pass(cwd);
  expect(decision(bash(c, cwd, "git commit -m x"))).not.toBe("deny");
});

test("only the trivial tier's checks are needed for a trivial task", () => {
  const cwd = repo();
  startTask(cwd, "trivial", "feature");
  pass(cwd);
  expect(decision(bash(config(), cwd, "git commit -m x"))).not.toBe("deny");
});

test("tierFloor: files, lines and critical paths since the task started", () => {
  const cwd = repo();
  const c = config();
  const t = startTask(cwd, "trivial", "feature");
  expect(tierFloor(cwd, c, t).floor).toBe("trivial");
  writeFileSync(join(cwd, "a.ts"), "export const a = 2;\n");
  expect(tierFloor(cwd, c, t).floor).toBe("trivial");
  for (const f of ["b.ts", "c.ts", "d.ts"]) writeFileSync(join(cwd, f), "x\n");
  expect(tierFloor(cwd, c, t).floor).toBe("standard");
  expect(tierFloor(cwd, c, t).why).toContain("4 files");
  const cwd2 = repo();
  const t2 = startTask(cwd2, "trivial", "feature");
  writeFileSync(join(cwd2, "big.ts"), "line\n".repeat(80));
  expect(tierFloor(cwd2, c, t2).floor).toBe("standard");
  const cwd3 = repo();
  const t3 = startTask(cwd3, "trivial", "feature");
  mkdirSync(join(cwd3, "db", "migrations"), { recursive: true });
  writeFileSync(join(cwd3, "db", "migrations", "001.sql"), "x\n");
  expect(tierFloor(cwd3, c, t3).floor).toBe("critical");
  // The floor measures from the task's start, committed or not; a new task starts clean.
  git(cwd3, "add", "-A");
  git(cwd3, "commit", "-q", "-m", "m");
  expect(tierFloor(cwd3, c, t3).floor).toBe("critical");
  expect(tierFloor(cwd3, c, startTask(cwd3, "trivial", "feature")).floor).toBe("trivial");
});

test("tierFloor fails open outside git", () => {
  const cwd = mkdtempSync(join(tmpdir(), "saw-vg-nogit-"));
  writeFileSync(join(cwd, "workflow.toml"), CHECKS);
  const t = startTask(cwd, "trivial", "feature");
  writeFileSync(join(cwd, "x.ts"), "x\n".repeat(500));
  expect(tierFloor(cwd, config(), t).floor).toBe("trivial");
});

test("below the floor: the guard and the gate point at saw task retier; retier keeps checks and refuses to lower", () => {
  const cwd = repo();
  const c = config();
  startTask(cwd, "trivial", "feature");
  pass(cwd);
  writeFileSync(join(cwd, "big.ts"), "line\n".repeat(80));
  const out = bash(c, cwd, "git commit -m x");
  expect(decision(out)).toBe("deny");
  expect(reason(out)).toContain("saw task retier standard");
  expect(gate(cwd, c, {})?.reason).toContain("saw task retier standard");
  const from = currentTask(cwd)!.from;
  expect(run(["task", "retier", "standard"], cwd)).toBe(0);
  expect(currentTask(cwd)).toMatchObject({ tier: "standard", from });
  expect(run(["task", "retier", "trivial"], cwd)).toBe(1);
  expect(currentTask(cwd)?.tier).toBe("standard");
  expect(run(["task", "retier", "nonsense"], cwd)).toBe(1);
  expect(() => retierTask(cwd, c, "trivial")).toThrow("at least standard");
  expect(gate(cwd, c, {})?.reason).not.toContain("Tier too low");
});

test("verify.mode soft leaves a below-floor task to the gate's usual checks", () => {
  const cwd = repo();
  startTask(cwd, "trivial", "feature");
  pass(cwd);
  writeFileSync(join(cwd, "big.ts"), "line\n".repeat(80));
  expect(decision(bash(config('[verify]\nmode = "soft"\n' + CHECKS), cwd, "git commit -m x"))).not.toBe("deny");
});

test("saw task end on a task that isn't Verified needs --reason, records it, and it is shown once", () => {
  const cwd = repo();
  startTask(cwd, "trivial", "feature");
  expect(run(["task", "end"], cwd)).toBe(1);
  expect(run(["task", "end", "--reason", "  "], cwd)).toBe(1);
  expect(currentTask(cwd)).toBeDefined();
  expect(run(["task", "end", "--reason", "needs a db"], cwd)).toBe(0);
  expect(currentTask(cwd)).toBeUndefined();
  expect(takeUnverifiedExit(cwd)).toMatchObject({ label: "Not verified", reason: "needs a db", tier: "trivial" });
  expect(takeUnverifiedExit(cwd)).toBeUndefined();
  startTask(cwd, "trivial", "feature");
  pass(cwd);
  expect(run(["task", "end"], cwd)).toBe(0);
  expect(existsSync(join(cwd, ".saw", "unverified-exit.json"))).toBe(false);
});

test("stale tasks: another session's task denies edits in hard mode until resumed or ended", () => {
  const cwd = repo();
  const c = config();
  const f = join(cwd, "a.ts");
  startTask(cwd, "standard", "feature");
  // No recorded session: counts as current.
  expect(staleTask(cwd, "s2")).toBeUndefined();
  expect(routingEdit(c, f, cwd, "s2")).toBeUndefined();
  setTaskSession(cwd, "s1");
  expect(currentTask(cwd)?.session).toBe("s1");
  setTaskSession(cwd, "s2"); // an owned task keeps its owner
  expect(currentTask(cwd)?.session).toBe("s1");
  expect(routingEdit(c, f, cwd, "s1")).toBeUndefined();
  expect(routingEdit(c, f, cwd, undefined)).toBeUndefined();
  const v = routingEdit(c, f, cwd, "s2");
  expect(v?.decision).toBe("deny");
  expect(v?.reason).toContain("saw resume");
  expect(v?.reason).toContain("saw task end --reason");
  expect(decision(guardHook(c, { tool_name: "Edit", session_id: "s2", tool_input: { file_path: f } }, cwd))).toBe("deny");
  expect(routingEdit(config('[routing]\nmode = "soft"\n'), f, cwd, "s2")).toBeUndefined();
  // saw resume takes it over.
  setTaskSession(cwd, "s2", true);
  expect(routingEdit(c, f, cwd, "s2")).toBeUndefined();
});

test("the Bash hook stamps the session on saw task start and takes over on saw resume", () => {
  const cwd = repo();
  const c = config();
  startTask(cwd, "standard", "feature");
  const post = (command: string, session_id: string, tool_response: unknown = {}) =>
    sessionHook(cwd, c, { hook_event_name: "PostToolUse", session_id, tool_name: "Bash", tool_input: { command }, tool_response });
  post("git status", "s1");
  expect(currentTask(cwd)?.session).toBeUndefined();
  post("saw task start --tier standard --playbook feature", "s1");
  expect(currentTask(cwd)?.session).toBe("s1");
  post("saw task start --tier standard --playbook feature", "s2");
  expect(currentTask(cwd)?.session).toBe("s1");
  post("saw resume", "s2", { exit_code: 1 });
  expect(currentTask(cwd)?.session).toBe("s1");
  post("saw resume", "s2");
  expect(currentTask(cwd)?.session).toBe("s2");
});

test("text that merely mentions saw resume doesn't claim the task; a plugin-path call does", () => {
  const cwd = repo();
  startTask(cwd, "standard", "feature");
  setTaskSession(cwd, "s1");
  const post = (command: string) => sessionHook(cwd, config(), { hook_event_name: "PostToolUse", session_id: "s2", tool_name: "Bash", tool_input: { command }, tool_response: {} });
  post('echo "saw resume"');
  post("git log --grep 'saw resume'");
  expect(currentTask(cwd)?.session).toBe("s1");
  post('"/plugins/saw/bin/saw" resume');
  expect(currentTask(cwd)?.session).toBe("s2");
});

test("agents can't loosen verify.mode or routing.mode with saw config set", () => {
  const c = config();
  for (const key of ["verify.mode", "routing.mode"]) {
    expect(decision(guardHook(c, { tool_name: "Bash", tool_input: { command: `saw config set ${key} soft` } }, repo()))).toBe("ask");
  }
});

test("a committed workflow.toml can't set verify.mode soft", () => {
  const dir = mkdtempSync(join(tmpdir(), "saw-vg-layer-"));
  writeFileSync(join(dir, "workflow.toml"), '[verify]\nmode = "soft"\n');
  const none = join(dir, "none.toml");
  const r = resolve(dir, {}, { global: none, project: join(dir, "workflow.toml"), local: none });
  expect((r.config.verify as { mode: string }).mode).toBe("hard");
});

test("files already changed when the task started don't count toward the floor until they change again", () => {
  const cwd = repo();
  const c = config();
  for (const f of ["b.ts", "c.ts", "d.ts", "e.ts"]) writeFileSync(join(cwd, f), "pre-existing\n");
  const t = startTask(cwd, "trivial", "feature");
  expect(tierFloor(cwd, c, t).floor).toBe("trivial");
  writeFileSync(join(cwd, "b.ts"), "edited by the task\n");
  expect(tierFloor(cwd, c, t).floor).toBe("trivial");
  for (const f of ["f.ts", "g.ts", "h.ts"]) writeFileSync(join(cwd, f), "new\n");
  expect(tierFloor(cwd, c, t).floor).toBe("standard");
});

test("session-start tells the agent and user about a stale task and an unverified exit, the latter once", () => {
  const cwd = repo();
  startTask(cwd, "standard", "feature");
  setTaskSession(cwd, "s1");
  const start = (session_id: string) => {
    const p = Bun.spawnSync(["bun", join(import.meta.dir, "..", "src", "main.ts"), "session-start"], { cwd, stdin: new TextEncoder().encode(JSON.stringify({ session_id, source: "startup" })), stdout: "pipe", stderr: "pipe" });
    return p.stdout.toString();
  };
  expect(start("s1")).not.toContain("another session");
  const out = JSON.parse(start("s2")) as { systemMessage: string; hookSpecificOutput: { additionalContext: string } };
  expect(out.systemMessage).toContain("belongs to another session");
  expect(out.hookSpecificOutput.additionalContext).toContain("saw resume");
  expect(run(["task", "end", "--reason", "abandoned"], cwd)).toBe(0);
  expect(start("s3")).toContain("closed Not verified");
  expect(start("s3")).not.toContain("closed Not verified");
});
