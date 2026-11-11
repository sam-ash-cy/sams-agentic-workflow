import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { guardHook } from "../src/guard";
import { subagentEdits, subagentHook } from "../src/subagent";
import { gate, startTask } from "../src/task";

const CHECKS = '[checks]\ntest = "exit 0"\n';
const HARD = '[routing]\nmode = "hard"\n[verify]\nmode = "hard"\n';
const git = (cwd: string, ...args: string[]): void => {
  Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
};

// A saw project that is a git repo with one commit, and its resolved settings.
function repo(): { cwd: string; config: ReturnType<typeof resolve>["config"] } {
  const cwd = mkdtempSync(join(tmpdir(), "saw-sub-"));
  writeFileSync(join(cwd, "workflow.toml"), HARD + CHECKS);
  writeFileSync(join(cwd, "a.ts"), "export const a = 1;\n");
  git(cwd, "init", "-q");
  git(cwd, "config", "user.email", "t@example.com");
  git(cwd, "config", "user.name", "t");
  git(cwd, "config", "commit.gpgsign", "false");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "init");
  const none = join(cwd, "none.toml");
  return { cwd, config: resolve(cwd, {}, { global: none, project: join(cwd, "workflow.toml"), local: none }).config };
}

function transcript(dir: string, paths: string[]): string {
  const p = join(dir, "agent.jsonl");
  const lines = [
    JSON.stringify({ type: "user", message: { content: "do it" } }),
    ...paths.map((f) => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: f } }] } })),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "ignored.ts" } }] } }),
    "{not json",
  ];
  writeFileSync(p, lines.join("\n"));
  return p;
}

const decision = (out: Record<string, unknown> | undefined): string | undefined => (out?.hookSpecificOutput as { permissionDecision?: string } | undefined)?.permissionDecision;

test("the routing edit guard applies to a subagent's edit (agent_id set)", () => {
  const { cwd, config } = repo();
  const out = guardHook(config, { tool_name: "Edit", session_id: "s1", agent_id: "agent-1", tool_input: { file_path: join(cwd, "a.ts") } }, cwd);
  expect(decision(out)).toBe("deny");
});

test("the verify commit guard applies to a subagent's git commit", () => {
  const { cwd, config } = repo();
  startTask(cwd, "trivial", "debug");
  const out = guardHook(config, { tool_name: "Bash", session_id: "s1", agent_id: "agent-1", tool_input: { command: "git commit -m x" } }, cwd);
  expect(decision(out)).toBe("deny");
});

test("the tier floor counts a subagent's edits: they are in the working tree", () => {
  const { cwd, config } = repo();
  startTask(cwd, "trivial", "debug");
  // What a subagent wrote: four new files, past routing.trivial_max_files (3).
  for (const n of [1, 2, 3, 4]) writeFileSync(join(cwd, `sub${n}.ts`), "export {};\n");
  const out = guardHook(config, { tool_name: "Bash", session_id: "s1", agent_id: "agent-1", tool_input: { command: "git commit -m x" } }, cwd);
  expect(String((out?.hookSpecificOutput as { permissionDecisionReason?: string }).permissionDecisionReason)).toContain("standard");
});

test("subagentEdits reads edit tool targets from the transcript, skipping reads and bad lines", () => {
  const dir = mkdtempSync(join(tmpdir(), "saw-sub-t-"));
  expect(subagentEdits(transcript(dir, ["a.ts", "b.ts", "a.ts"]))).toEqual(["a.ts", "b.ts"]);
  expect(subagentEdits(join(dir, "missing.jsonl"))).toEqual([]);
});

test("SubagentStop with no task open arms the untasked-edit Stop check", () => {
  const { cwd, config } = repo();
  const files = subagentHook(cwd, config, { agent_transcript_path: transcript(cwd, [join(cwd, "a.ts"), "/elsewhere/x.ts"]), agent_type: "implementer" });
  expect(files).toEqual(["a.ts"]);
  expect(existsSync(join(cwd, ".saw", "untasked-edits"))).toBe(true);
  const block = gate(cwd, config, { session_id: "s1" });
  expect(block?.reason).toContain("no saw task is open");
});

test("SubagentStop with a task open logs the edits against it", () => {
  const { cwd, config } = repo();
  startTask(cwd, "standard", "feature");
  subagentHook(cwd, config, { agent_transcript_path: transcript(cwd, ["a.ts"]), agent_type: "implementer" });
  expect(existsSync(join(cwd, ".saw", "untasked-edits"))).toBe(false);
  const events = readFileSync(join(cwd, ".saw", "events.jsonl"), "utf8");
  expect(events).toContain('"kind":"subagent.edits"');
  expect(events).toContain('"tier":"standard"');
});

test("SubagentStop outside a saw project does nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "saw-sub-none-"));
  expect(subagentHook(dir, {}, { agent_transcript_path: transcript(dir, ["a.ts"]) })).toEqual([]);
});

test("SubagentStop ignores edits in a nested worktree under .claude/", () => {
  const { cwd, config } = repo();
  expect(subagentHook(cwd, config, { agent_transcript_path: transcript(cwd, [join(cwd, ".claude", "worktrees", "x", "a.ts")]) })).toEqual([]);
  expect(existsSync(join(cwd, ".saw", "untasked-edits"))).toBe(false);
});
