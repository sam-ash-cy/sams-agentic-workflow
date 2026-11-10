import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { guardHook } from "../src/guard";
import { routingEdit } from "../src/routing-guard";
import { startTask } from "../src/task";

function config(toml = ""): ReturnType<typeof resolve>["config"] {
  const dir = mkdtempSync(join(tmpdir(), "saw-rg-"));
  writeFileSync(join(dir, "workflow.toml"), toml);
  const none = join(dir, "none.toml");
  return resolve(dir, {}, { global: none, project: none, local: join(dir, "workflow.toml") }).config;
}
function repo(workflow = true): string {
  const cwd = mkdtempSync(join(tmpdir(), "saw-rg-"));
  if (workflow) writeFileSync(join(cwd, "workflow.toml"), "");
  return cwd;
}
const decision = (out: Record<string, unknown> | undefined): string | undefined => (out?.hookSpecificOutput as { permissionDecision?: string } | undefined)?.permissionDecision;

test("hard is the default: an edit with no task is denied, naming the way out", () => {
  const cwd = repo();
  const v = routingEdit(config(), join(cwd, "src", "a.ts"), cwd);
  expect(v?.decision).toBe("deny");
  expect(v?.reason).toContain("router skill");
  expect(v?.reason).toContain("saw task start --tier <t> --playbook <p>");
  expect(v?.reason).toContain("saw task adhoc");
});

test("an open task, soft mode, verify_hook off and non-saw projects let edits through", () => {
  const cwd = repo();
  const f = join(cwd, "a.ts");
  expect(routingEdit(config('[routing]\nmode = "soft"\n'), f, cwd)).toBeUndefined();
  expect(routingEdit(config("[features]\nverify_hook = false\n"), f, cwd)).toBeUndefined();
  expect(routingEdit(config(), f, repo(false))).toBeUndefined();
  expect(routingEdit(config(), undefined, cwd)).toBeUndefined();
  startTask(cwd, "standard", "feature");
  expect(routingEdit(config(), f, cwd)).toBeUndefined();
});

test("saw state, .claude, plan files and paths outside the repo are exempt", () => {
  const cwd = repo();
  for (const f of [".saw/task.json", ".claude/settings.json", "plans/x.md", join(tmpdir(), "elsewhere", "a.ts"), "../other/a.ts"]) {
    expect(routingEdit(config(), f.startsWith("/") || f.includes(":") ? f : join(cwd, f), cwd)).toBeUndefined();
  }
  expect(routingEdit(config(), join(cwd, "notes", "plans.md"), cwd)?.decision).toBe("deny");
});

test("guardHook denies Edit, Write, MultiEdit and NotebookEdit; subagents are covered too", () => {
  const cwd = repo();
  mkdirSync(join(cwd, "src"), { recursive: true });
  const c = config();
  for (const tool of ["Edit", "Write", "MultiEdit"]) {
    expect(decision(guardHook(c, { tool_name: tool, tool_input: { file_path: join(cwd, "src", "a.ts") } }, cwd))).toBe("deny");
  }
  expect(decision(guardHook(c, { tool_name: "NotebookEdit", tool_input: { notebook_path: join(cwd, "n.ipynb") } }, cwd))).toBe("deny");
  expect(decision(guardHook(c, { tool_name: "Edit", agent_id: "sub-1", tool_input: { file_path: join(cwd, "src", "a.ts") } }, cwd))).toBe("deny");
  startTask(cwd, "trivial", "feature");
  expect(decision(guardHook(c, { tool_name: "Edit", tool_input: { file_path: join(cwd, "src", "a.ts") } }, cwd))).not.toBe("deny");
});
