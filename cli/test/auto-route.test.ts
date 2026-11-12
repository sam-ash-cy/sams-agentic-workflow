import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify } from "../src/auto-route";
import { resolve } from "../src/config";
import { routerNudge } from "../src/context";
import { currentTask, openProvisional, retierTask, startTask } from "../src/task";
import { verifyBlock } from "../src/verify-guard";

// prompt → expected tier / playbook, or "none" for questions and non-change prompts.
const CASES: [string, string][] = [
  ["what does tierFloor do?", "none"],
  ["Why is the gate blocking my stop?", "none"],
  ["explain how the router skill picks a tier", "none"],
  ["how do I add a new playbook?", "none"],
  ["thanks, looks good", "none"],
  ["show me the failing tests", "none"],
  ["fix the typo in the README", "trivial/feature"],
  ["rename the helper in utils.ts", "trivial/feature"],
  ["update the wording on the settings page", "trivial/design"],
  ["fix the crash when the config file is empty", "standard/debug"],
  ["the export button is broken, please fix it", "standard/debug"],
  ["can you fix the failing test in task.test.ts?", "standard/debug"],
  ["add a --json flag to saw doctor", "standard/feature"],
  ["implement pagination for the events list", "standard/feature"],
  ["make the dashboard layout responsive", "standard/design"],
  ["fix the login redirect loop", "critical/debug"],
  ["add a migration that backfills the user email column", "critical/feature"],
  ["rotate the api keys used by the deploy script", "critical/feature"],
  ["update .github/workflows/ci.yml to cache bun", "critical/feature"],
  ["add stripe refunds to checkout", "critical/feature"],
  ["integrate the slack webhook for alerts", "complex/integration"],
  ["rewrite the guard as a new module with its own rules engine", "complex/feature"],
  ["prototype a vector search over the docs", "standard/spike"],
  ["harden the hook input parsing against bad payloads", "standard/hardening"],
  ["scaffold the project with bun and a CLI entry", "complex/foundation"],
  ["audit the dependencies for licences", "standard/audit"],
  ["do the schema migration for orders", "critical/feature"],
  ["is the gate broken?", "none"],
];

test.each(CASES)("classify %p → %p", (prompt, expected) => {
  const r = classify(prompt);
  expect(r === "none" ? "none" : `${r.tier}/${r.playbook}`).toBe(expected);
});

function project(toml: string): { cwd: string; config: ReturnType<typeof resolve>["config"] } {
  const cwd = mkdtempSync(join(tmpdir(), "saw-auto-"));
  writeFileSync(join(cwd, "workflow.toml"), toml);
  const none = join(cwd, "none.toml");
  return { cwd, config: resolve(cwd, {}, { global: none, project: none, local: join(cwd, "workflow.toml") }).config };
}

const text = (o: Record<string, unknown> | undefined): string => JSON.stringify(o ?? {});

test("suggest adds the proposed saw task start line to the router nudge, not for questions", () => {
  const { cwd, config } = project('[routing]\nauto = "suggest"\n[checks]\ntest = "exit 0"\n');
  expect(text(routerNudge(cwd, config, "fix the crash when the config file is empty"))).toContain("saw task start --tier standard --playbook debug");
  expect(text(routerNudge(cwd, config, "what does this do?"))).not.toContain("Proposed");
  expect(currentTask(cwd)).toBeUndefined();
});

test("off leaves the nudge as it was", () => {
  const { cwd, config } = project('[routing]\nauto = "off"\n');
  expect(text(routerNudge(cwd, config, "fix the crash"))).not.toContain("Proposed");
});

test("an audit proposal falls back to feature while features.audit is off", () => {
  const { cwd, config } = project('[routing]\nauto = "suggest"\n[features]\naudit = false\n');
  expect(text(routerNudge(cwd, config, "audit the dependencies"))).toContain("--playbook feature");
});

test("open starts a provisional task; verify holds commits until it is confirmed", () => {
  const { cwd, config } = project('[routing]\nauto = "open"\n[verify]\nmode = "hard"\n[checks]\ntest = "exit 0"\n');
  expect(text(routerNudge(cwd, config, "fix the crash when the config file is empty"))).toContain("provisional");
  const t = currentTask(cwd)!;
  expect(t.provisional).toBe(true);
  expect(t.tier).toBe("standard");
  expect(verifyBlock(config, cwd)?.reason).toContain("provisionally");
  retierTask(cwd, config, "standard");
  expect(currentTask(cwd)!.provisional).toBeUndefined();
  expect(verifyBlock(config, cwd)?.reason ?? "").not.toContain("provisionally");
});

test("saw task start replaces a provisional task with a confirmed one", () => {
  const { cwd, config } = project('[routing]\nauto = "open"\n');
  routerNudge(cwd, config, "add a --json flag to saw doctor");
  expect(currentTask(cwd)!.provisional).toBe(true);
  startTask(cwd, "trivial", "feature");
  expect(currentTask(cwd)!.provisional).toBeUndefined();
});

test("soft routing with auto = open: an untasked edit opens a provisional task and Stop doesn't block", () => {
  const dir = mkdtempSync(join(tmpdir(), "saw-ar-"));
  writeFileSync(join(dir, "workflow.toml"), '[checks]\ntest = "exit 0"\n');
  const home = mkdtempSync(join(tmpdir(), "saw-ar-home-"));
  const env = { ...process.env, SAW_HOME: home, HOME: home, USERPROFILE: home } as Record<string, string>;
  const main = join(import.meta.dir, "..", "src", "main.ts");
  const hook = (name: string, payload: unknown): string =>
    Bun.spawnSync(["bun", main, name], { cwd: dir, env, stdin: Buffer.from(JSON.stringify(payload)), stdout: "pipe", stderr: "pipe", timeout: 20000 }).stdout.toString();
  hook("format-hook", { tool_name: "Edit", tool_input: { file_path: join(dir, "a.ts") } });
  expect(currentTask(dir)?.provisional).toBe(true);
  expect(existsSync(join(dir, ".saw", "untasked-edits"))).toBe(false);
  expect(hook("gate", { session_id: "s1" })).toBe("");
});

test("hard routing still marks untasked edits for the Stop gate", () => {
  const dir = mkdtempSync(join(tmpdir(), "saw-ar-"));
  writeFileSync(join(dir, "workflow.toml"), '[routing]\nmode = "hard"\n');
  const home = mkdtempSync(join(tmpdir(), "saw-ar-home-"));
  const env = { ...process.env, SAW_HOME: home, HOME: home, USERPROFILE: home } as Record<string, string>;
  const main = join(import.meta.dir, "..", "src", "main.ts");
  Bun.spawnSync(["bun", main, "format-hook"], { cwd: dir, env, stdin: Buffer.from(JSON.stringify({ tool_name: "Edit", tool_input: { file_path: join(dir, "a.ts") } })), stdout: "pipe", stderr: "pipe", timeout: 20000 });
  expect(currentTask(dir)).toBeUndefined();
  expect(existsSync(join(dir, ".saw", "untasked-edits"))).toBe(true);
});

test("a provisional task opened by an edit counts that edit as its own work", () => {
  const dir = mkdtempSync(join(tmpdir(), "saw-ar-"));
  writeFileSync(join(dir, "workflow.toml"), "");
  const git = (...a: string[]) => Bun.spawnSync(["git", ...a], { cwd: dir, stdout: "pipe", stderr: "pipe", timeout: 10000 });
  git("init", "-q");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  writeFileSync(join(dir, "a.ts"), "x\n");
  writeFileSync(join(dir, "old.ts"), "y\n");
  const t = openProvisional(dir, "standard", "feature", join(dir, "a.ts"));
  expect(Object.keys(t.baseDirty ?? {})).not.toContain("a.ts");
  expect(Object.keys(t.baseDirty ?? {})).toContain("old.ts");
  expect(currentTask(dir)?.baseDirty?.["a.ts"]).toBeUndefined();
});
