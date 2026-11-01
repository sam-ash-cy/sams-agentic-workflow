import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { guardCommand, guardHook, rewriteCommand } from "../src/guard";
import type { Gh } from "../src/repo";
import { syncSkillDenies } from "../src/skills";
import { taskSteps } from "../src/task";

const tmp = (p: string): string => mkdtempSync(join(tmpdir(), p));

function config(toml = ""): ReturnType<typeof resolve>["config"] {
  const dir = tmp("saw-r3-");
  writeFileSync(join(dir, "workflow.toml"), toml);
  const none = join(dir, "none.toml");
  return resolve(dir, {}, { global: none, project: join(dir, "workflow.toml"), local: none }).config;
}

test("output.rewrite_commands rewrites an exact check command into saw run", () => {
  const checks = '[checks]\ntest = "bun test"\n';
  expect(rewriteCommand(config(checks), "bun test")).toBeUndefined();
  const on = config(`${checks}[output]\nrewrite_commands = true\n`);
  expect(rewriteCommand(on, "  bun   test ")).toEndWith("run test");
  expect(rewriteCommand(on, "bun test && rm x")).toBeUndefined();
  const out = guardHook(on, { tool_name: "Bash", tool_input: { command: "bun test" } }) as { hookSpecificOutput: Record<string, unknown> };
  expect(out.hookSpecificOutput.updatedInput).toEqual({ command: expect.stringContaining("run test") });
  // Never a permission decision: the usual prompt still applies.
  expect(out.hookSpecificOutput.permissionDecision).toBeUndefined();
});

test("worktrees and parallel_sessions shape the steps and the guard", () => {
  expect(taskSteps(config(), "complex")).toContain("one worktree per task");
  expect(taskSteps(config(), "standard")).not.toContain("one worktree per task");
  expect(taskSteps(config("[features]\nworktrees = false\n"), "complex")).not.toContain("one worktree per task");
  expect(guardCommand(config(), "git worktree add ../x")).toBeUndefined();
  expect(guardCommand(config("[features]\nworktrees = false\n"), "git worktree add ../x")?.decision).toBe("deny");

  expect(guardCommand(config(), 'claude -p "do x"')?.decision).toBe("deny");
  const par = config("[features]\nparallel_sessions = true\n");
  expect(taskSteps(par, "critical").join(" ")).toContain("split independent steps into sessions");
  expect(taskSteps(config(), "critical").join(" ")).not.toContain("sessions");
  expect(guardCommand(par, 'claude -p "do x"')?.decision).toBe("ask");
  expect(guardCommand(config("[features]\nparallel_sessions = true\n[autonomy.actions]\nspawn_sessions = \"allow\"\n"), "claude --print x")).toBeUndefined();
});

test("saw sync denies disabled features' skills and removes only its own entries", () => {
  const dir = tmp("saw-skills-");
  mkdirSync(join(dir, ".claude"));
  const path = join(dir, ".claude", "settings.json");
  writeFileSync(path, JSON.stringify({ model: "x", permissions: { deny: ["Bash(rm:*)", "Skill(mattpocock-skills:tdd)"] } }));
  const off = config("[features]\ngrilling = false\ntdd = false\n");
  expect(syncSkillDenies(dir, off, true).added).toEqual(["Skill(mattpocock-skills:grilling)"]);
  expect(JSON.parse(readFileSync(path, "utf8")).permissions.deny).toHaveLength(2);
  syncSkillDenies(dir, off);
  const s = JSON.parse(readFileSync(path, "utf8"));
  expect(s.model).toBe("x");
  expect(s.permissions.deny).toEqual(["Bash(rm:*)", "Skill(mattpocock-skills:tdd)", "Skill(mattpocock-skills:grilling)"]);
  // Re-enabled: saw's entry goes; the user's own tdd deny stays.
  expect(syncSkillDenies(dir, config())).toEqual({ added: [], removed: ["Skill(mattpocock-skills:grilling)"] });
  expect(JSON.parse(readFileSync(path, "utf8")).permissions.deny).toEqual(["Bash(rm:*)", "Skill(mattpocock-skills:tdd)"]);
  expect(existsSync(join(dir, ".saw", "skill-denies.json"))).toBe(false);
  writeFileSync(path, "{ not json");
  expect(() => syncSkillDenies(dir, off)).toThrow("isn't valid JSON");
});

test("saw init --repo prints the repo plan read-only, even with repo.enabled off", async () => {
  const { initRepoPlan } = await import("../src/main");
  const dir = tmp("saw-initrepo-");
  writeFileSync(join(dir, "workflow.toml"), "");
  const calls: string[][] = [];
  const fake: Gh = (a) => {
    calls.push(a);
    return a[0] === "repo" ? { code: 0, out: "o/r\n" } : { code: 0, out: a.includes("labels") ? "[]" : "{}" };
  };
  const args = { positional: [], flags: new Set<string>(), scope: "project" as const, overrides: {}, values: { repo: "" } };
  expect(initRepoPlan(dir, args, fake)).toBe(0);
  expect(calls.some((c) => c.includes("PATCH") || c.includes("PUT") || c.includes("POST"))).toBe(false);
});

test("a bare value flag doesn't swallow the next flag", async () => {
  const { run } = await import("../src/main");
  const dir = tmp("saw-bare-");
  // --agents with no value: --dry-run must still apply, so nothing is written.
  run(["init", "--agents", "--dry-run"], dir);
  expect(existsSync(join(dir, "workflow.toml"))).toBe(false);
});

const ROOT = join(import.meta.dir, "..", "..");

test("the global fragment stays within 150 lines", () => {
  expect(readFileSync(join(ROOT, "global", "CLAUDE.md"), "utf8").trimEnd().split("\n").length).toBeLessThanOrEqual(150);
  expect(() => JSON.parse(readFileSync(join(ROOT, "global", "settings.example.json"), "utf8"))).not.toThrow();
});

// Each bootstrap script: dry run writes nothing; a real run imports the
// fragment, backs up the existing CLAUDE.md and keeps an existing settings.json.
const shells: [string, string[]][] = [["bootstrap.sh", ["sh", join(ROOT, "bootstrap.sh")]]];
if (process.platform === "win32") shells.push(["bootstrap.ps1", ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "bootstrap.ps1")]]);
for (const [name, cmd] of shells) {
  test(`${name}: dry run, backup, idempotent`, () => {
    const home = tmp("saw-boot-");
    writeFileSync(join(home, "CLAUDE.md"), "mine\n");
    writeFileSync(join(home, "settings.json"), '{"mine":true}\n');
    const env = { ...process.env, CLAUDE_CONFIG_DIR: home, SAW_NO_PLUGIN: "1" };
    const go = (dry: boolean): string => {
      const p = Bun.spawnSync([...cmd, ...(dry ? [name.endsWith(".ps1") ? "-DryRun" : "--dry-run"] : [])], { env, stderr: "pipe" });
      expect(`${p.exitCode} ${p.stderr.toString()}`).toBe("0 ");
      return p.stdout.toString();
    };
    expect(go(true)).toContain("saw-workflow.md");
    expect(readFileSync(join(home, "CLAUDE.md"), "utf8")).toBe("mine\n");
    expect(existsSync(join(home, "saw-workflow.md"))).toBe(false);
    go(false);
    expect(readFileSync(join(home, "CLAUDE.md"), "utf8")).toStartWith("mine\n");
    expect(readFileSync(join(home, "CLAUDE.md"), "utf8")).toContain("@saw-workflow.md");
    expect(readFileSync(join(home, "settings.json"), "utf8")).toBe('{"mine":true}\n');
    const backups = (): number => readdirSync(home).filter((f) => f.startsWith("CLAUDE.md.bak.")).length;
    expect(backups()).toBe(1);
    expect(go(false)).not.toContain("append");
    expect(backups()).toBe(1);
    // Windows PowerShell can take tens of seconds to start on a cold CI runner.
  }, 120_000);
}
