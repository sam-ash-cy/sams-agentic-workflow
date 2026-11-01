import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { sessionHook, unitOf, type SessionHookInput } from "../src/sessions";

function config(toml = ""): ReturnType<typeof resolve>["config"] {
  const dir = mkdtempSync(join(tmpdir(), "saw-ses-"));
  writeFileSync(join(dir, "workflow.toml"), toml);
  const none = join(dir, "none.toml");
  return resolve(dir, {}, { global: none, project: join(dir, "workflow.toml"), local: none }).config;
}

const bash = (event: string, command: string, session_id = "s1", tool_response?: unknown): SessionHookInput =>
  ({ hook_event_name: event, session_id, tool_name: "Bash", tool_input: { command }, tool_response });
const START_9 = "saw task start --tier complex --playbook feature --unit phase --unit-id phase-9";
const START_10 = "saw task start --tier complex --playbook feature --unit phase --unit-id phase-10";

// Runs a session that opened phase 9 and committed it.
function finishedPhase9(cwd: string, cfg = config()): void {
  expect(sessionHook(cwd, cfg, bash("PreToolUse", START_9))).toBeUndefined();
  sessionHook(cwd, cfg, bash("PostToolUse", START_9));
  sessionHook(cwd, cfg, bash("PostToolUse", 'git commit -m "feat: phase 9"'), new Date(Date.now() - 60_000));
}

test("unitOf reads --unit and --unit-id from a task start", () => {
  expect(unitOf(START_10)).toEqual({ kind: "phase", id: "phase-10" });
  expect(unitOf('bun cli/src/main.ts task start --unit stage --unit-id "stage 2"')).toEqual({ kind: "stage", id: "stage 2" });
  expect(unitOf("saw task start --tier standard")).toBeUndefined();
  expect(unitOf("saw task start --unit epic --unit-id x")).toBeUndefined();
  expect(unitOf("echo --unit phase")).toBeUndefined();
});

test("soft: a second phase after a commit warns; a same-phase follow-up doesn't", () => {
  const cwd = mkdtempSync(join(tmpdir(), "saw-ses-"));
  finishedPhase9(cwd);
  const out = sessionHook(cwd, config(), bash("PreToolUse", START_10)) as { systemMessage: string; hookSpecificOutput: Record<string, unknown> };
  expect(out.systemMessage).toContain("finished phase phase-9");
  expect(out.hookSpecificOutput.permissionDecision).toBeUndefined();
  expect(sessionHook(cwd, config(), bash("PreToolUse", START_9))).toBeUndefined();
  expect(sessionHook(cwd, config(), bash("PreToolUse", "saw task start --tier standard --playbook debug"))).toBeUndefined();
  // A fresh session starts clean.
  expect(sessionHook(cwd, config(), bash("PreToolUse", START_10, "s2"))).toBeUndefined();
});

test("nothing finished, or a failed commit, doesn't step in; a PR counts as finished", () => {
  const cwd = mkdtempSync(join(tmpdir(), "saw-ses-"));
  sessionHook(cwd, config(), bash("PostToolUse", START_9));
  expect(sessionHook(cwd, config(), bash("PreToolUse", START_10))).toBeUndefined();
  sessionHook(cwd, config(), bash("PostToolUse", "git commit -m x", "s1", { exit_code: 1 }));
  expect(sessionHook(cwd, config(), bash("PreToolUse", START_10))).toBeUndefined();
  sessionHook(cwd, config(), bash("PostToolUse", "gh pr create --fill"));
  expect(sessionHook(cwd, config(), bash("PreToolUse", START_10))).toBeDefined();
});

test("a commit with no unit open, an echo or a dry run finishes nothing; a chained commit does", () => {
  const cwd = mkdtempSync(join(tmpdir(), "saw-ses-"));
  sessionHook(cwd, config(), bash("PostToolUse", "git commit -m typo"));
  sessionHook(cwd, config(), bash("PostToolUse", START_9));
  sessionHook(cwd, config(), bash("PostToolUse", 'echo "git commit later"'));
  sessionHook(cwd, config(), bash("PostToolUse", "git commit --dry-run"));
  expect(sessionHook(cwd, config(), bash("PreToolUse", START_10))).toBeUndefined();
  expect(sessionHook(cwd, config(), bash("PreToolUse", `git commit -m x && ${START_10}`))).toBeDefined();
  // Another session in the same checkout keeps its own state.
  sessionHook(cwd, config(), bash("PostToolUse", START_10, "s2"));
  sessionHook(cwd, config(), bash("PostToolUse", `git commit -m x && ${START_10}`));
  expect(sessionHook(cwd, config(), bash("PreToolUse", "saw task start --unit feature --unit-id f"))).toBeDefined();
});

test("sessions.mode = hard denies until a fresh session, and notices the handoff", () => {
  const hard = config('[sessions]\nmode = "hard"\n');
  const cwd = mkdtempSync(join(tmpdir(), "saw-ses-"));
  finishedPhase9(cwd, hard);
  const deny = (sessionHook(cwd, hard, bash("PreToolUse", START_10)) as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput;
  expect(deny.permissionDecision).toBe("deny");
  expect(deny.permissionDecisionReason).toContain("Write a handoff (prompts/handoff.md)");
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  const handoff = join(cwd, "docs", "plans", "handoff-2026-11-01.md");
  writeFileSync(handoff, "next: phase 10\n");
  const reason = (sessionHook(cwd, hard, bash("PreToolUse", START_10)) as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput.permissionDecisionReason;
  expect(reason).toContain("The handoff is written");
  // An old handoff from before the finish doesn't count.
  utimesSync(handoff, new Date(2000, 0, 1), new Date(2000, 0, 1));
  expect((sessionHook(cwd, hard, bash("PreToolUse", START_10)) as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput.permissionDecisionReason).toContain("Write a handoff");
  expect(sessionHook(cwd, hard, bash("PreToolUse", START_10, "s2"))).toBeUndefined();
});

test("sessions.new_per picks the unit kinds; [] turns the hook off", () => {
  const phaseOnly = config('[sessions]\nnew_per = ["phase"]\n');
  const cwd = mkdtempSync(join(tmpdir(), "saw-ses-"));
  finishedPhase9(cwd, phaseOnly);
  const feature = "saw task start --tier standard --unit feature --unit-id login";
  expect(sessionHook(cwd, phaseOnly, bash("PreToolUse", feature))).toBeUndefined();
  expect(sessionHook(cwd, config(), bash("PreToolUse", feature))).toBeDefined();
  expect(sessionHook(cwd, config("[sessions]\nnew_per = []\n"), bash("PreToolUse", START_10))).toBeUndefined();
});
