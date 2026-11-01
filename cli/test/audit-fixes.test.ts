import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { budgetHook, budgetNudge } from "../src/context";
import { guardCommand, guardHook } from "../src/guard";
import { lintMemory } from "../src/lint";
import { formatHook } from "../src/run";
import { recordCheck, startTask, taskReport } from "../src/task";

function setup(toml = ""): { dir: string; config: ReturnType<typeof resolve>["config"] } {
  const dir = mkdtempSync(join(tmpdir(), "saw-fix-"));
  writeFileSync(join(dir, "workflow.toml"), toml);
  const none = join(dir, "none.toml");
  return { dir, config: resolve(dir, {}, { global: none, project: join(dir, "workflow.toml"), local: none }).config };
}

test("guard denies the deny-list and push=never, asks for ask actions, allows the rest", () => {
  const { config } = setup();
  expect(guardCommand(config, "rm   -rf /")?.decision).toBe("deny");
  expect(guardCommand(config, "rm -fr build")?.decision).toBe("deny");
  expect(guardCommand(config, "rm -r -f build")?.decision).toBe("deny");
  expect(guardCommand(config, "rm --recursive --force build")?.decision).toBe("deny");
  expect(guardCommand(config, "rm -r build")).toBeUndefined();
  expect(guardCommand(config, "git push origin main")?.decision).toBe("deny");
  expect(guardCommand(config, "git commit -m x")?.decision).toBe("ask");
  expect(guardCommand(config, "gh pr create --fill")?.decision).toBe("ask");
  expect(guardCommand(config, "bun add left-pad")?.decision).toBe("ask");
  expect(guardCommand(config, "bun install")).toBeUndefined();
  expect(guardCommand(config, "git status --short")).toBeUndefined();
  const out = guardHook(config, { tool_name: "Bash", tool_input: { command: "git push" } }) as { hookSpecificOutput: { permissionDecision: string } };
  expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(guardHook(config, { tool_name: "Read", tool_input: {} })).toBeUndefined();
});

test("a committed project can't relax push below safety.push", () => {
  const { config } = setup('[autonomy.actions]\npush = "allow"\n');
  expect(guardCommand(config, "git push")?.decision).toBe("deny");
});

test("budget warns at warn_at, then once at 100%, with hard-mode wording", () => {
  const { config } = setup();
  expect(budgetNudge(config, "trivial", 10000, [])).toBeUndefined();
  expect(budgetNudge(config, "trivial", 17000, [])?.share).toBe(0.8);
  expect(budgetNudge(config, "trivial", 17000, [0.8])).toBeUndefined();
  expect(budgetNudge(config, "trivial", 21000, [0.8])?.share).toBe(1);
  const hard = setup('[tokens]\nmode = "hard"\n').config;
  expect(budgetNudge(hard, "trivial", 21000, [])?.message).toContain("Stop at the next safe point");
});

test("budget hook reads tokens since the task started and fires once", () => {
  const { dir, config } = setup();
  const transcript = join(dir, "t.jsonl");
  const usage = { input_tokens: 25000, output_tokens: 0 };
  writeFileSync(transcript, [JSON.stringify({ timestamp: "2000-01-01T00:00:00Z", message: { usage } }), JSON.stringify({ timestamp: "2999-01-01T00:00:00Z", message: { usage } })].join("\n"));
  const task = { tier: "trivial", started: "2026-01-01T00:00:00Z" };
  expect(budgetHook(dir, config, task, { transcript_path: transcript })).toBeDefined();
  expect(budgetHook(dir, config, task, { transcript_path: transcript })).toBeUndefined();
  const off = setup("[features]\nbudgets = false\n");
  expect(budgetHook(off.dir, off.config, task, { transcript_path: transcript })).toBeUndefined();
});

test("format hook runs checks.format after edits and reports failures only", () => {
  const ok = setup('[checks]\nformat = "exit 0"\n');
  expect(formatHook(ok.dir, ok.config, { tool_name: "Edit" }, "local")).toBeUndefined();
  const bad = setup('[checks]\nformat = "exit 3"\n');
  expect(JSON.stringify(formatHook(bad.dir, bad.config, { tool_name: "Write" }, "local"))).toContain("exit 3");
  expect(formatHook(bad.dir, bad.config, { tool_name: "Read" }, "local")).toBeUndefined();
  expect(formatHook(setup().dir, setup().config, { tool_name: "Edit" }, "local")).toBeUndefined();
});

test("memory lint finds stale paths and duplicate learnings", () => {
  const { dir, config } = setup();
  mkdirSync(join(dir, "docs", "learnings"), { recursive: true });
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "a.ts"), "");
  writeFileSync(join(dir, "docs", "learnings", "one.md"), "# Cache keys\nSee `src/a.ts:3` and `src/gone.ts`.\n");
  writeFileSync(join(dir, "docs", "learnings", "two.md"), "# Cache keys\n");
  const problems = lintMemory(dir, config);
  expect(problems).toHaveLength(2);
  expect(problems[0]).toContain("src/gone.ts");
  expect(problems[1]).toContain("same title");
});

test("critical tasks need a rollback plan, and the report labels each check", () => {
  const { dir, config } = setup();
  const task = startTask(dir, "critical", "integration");
  recordCheck(dir, { name: "code_review", status: "pass", how: "recorded", note: "clean" });
  const report = taskReport(dir, config, task);
  expect(report).toContain("**Verification: Partially verified**");
  expect(report).toContain("- Verified: `code_review` (clean)");
  expect(report).toContain("- Not verified: `rollback_plan`");
});
