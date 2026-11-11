// Every setting must do something: a fitness test that each default key is
// read by the CLI or a hook, plus a flip test for each toggle without one elsewhere.

import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { flatten, resolve } from "../src/config";
import { DEFAULTS, type Table } from "../src/defaults";
import { modelFor } from "../src/agents";
import { guardCommand, guardEdit } from "../src/guard";
import { formatHook } from "../src/run";
import { pickTier, requiredChecks, taskSteps } from "../src/task";

// Keys deliberately read by nothing in cli/src or hooks/, each with its reason.
const INERT: Record<string, string> = {
  "project.type": "set by saw init --type for the foundation and design playbooks to read; no CLI behaviour depends on it",
};

// Maps whose entries are user-defined names (tiers, roles, checks): the map itself must be read.
const MAPS = ["verify", "checks", "tokens.budget", "style.by_tier", "review_session.budget_by_tier", "models.roles", "autonomy.actions"];

const ROOT = join(import.meta.dir, "..", "..");
const source = [
  ...readdirSync(join(ROOT, "cli", "src")).filter((f) => !["defaults.ts", "schema.ts"].includes(f)).map((f) => readFileSync(join(ROOT, "cli", "src", f), "utf8")),
  readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8"),
].join("\n");

function isRead(key: string): boolean {
  const map = MAPS.find((m) => key.startsWith(`${m}.`));
  const leaf = (map ?? key).split(".").pop()!;
  if (key.startsWith("features.")) return source.split("\n").some((l) => /features/i.test(l) && new RegExp(`\\b${leaf}\\b`).test(l));
  return new RegExp(`\\b${leaf}\\b`).test(source);
}

test("every default setting is read by the CLI or a hook, or allowlisted with a reason", () => {
  const unread = Object.keys(flatten(DEFAULTS)).filter((k) => !INERT[k] && !isRead(k));
  expect(unread).toEqual([]);
  expect(Object.keys(INERT).length).toBeLessThanOrEqual(2);
});

function config(toml = ""): Table {
  const dir = mkdtempSync(join(tmpdir(), "saw-set-"));
  writeFileSync(join(dir, "workflow.toml"), toml);
  const none = join(dir, "none.toml");
  return resolve(dir, {}, { global: none, project: none, local: join(dir, "workflow.toml") }).config;
}

test("grilling, tdd, trail and routing.always_grill shape the task steps", () => {
  const on = taskSteps(config("[features]\ntrail = true\n"), "complex");
  expect(on).toContain("grilling first");
  expect(on).toContain("tdd (failing test first)");
  expect(on).toContain("trail ask/skeleton before reading code");
  expect(taskSteps(config(), "standard")).not.toContain("grilling first");
  expect(taskSteps(config('[routing]\nalways_grill = ["standard"]\n'), "standard")).toContain("grilling first");
  const off = taskSteps(config("[features]\ngrilling = false\ntdd = false\n"), "complex");
  expect(off).not.toContain("grilling first");
  expect(off).not.toContain("tdd (failing test first)");
  expect(taskSteps(config(), "complex")).not.toContain("trail ask/skeleton before reading code");
});

test("code_review and security_review off drop those checks", () => {
  expect(requiredChecks(config(), "standard")).toContain("code_review");
  const off = requiredChecks(config("[features]\ncode_review = false\nsecurity_review = false\n"), "critical");
  expect(off).not.toContain("code_review");
  expect(off).not.toContain("security_review");
  expect(off).toContain("rollback_plan");
});

test("routing.default_tier picks the tier when --tier is left out", () => {
  expect(() => pickTier(config(), undefined)).toThrow("--tier");
  expect(pickTier(config('[routing]\ndefault_tier = "trivial"\n'), undefined)).toBe("trivial");
  expect(pickTier(config('[routing]\ndefault_tier = "trivial"\n'), "critical")).toBe("critical");
});

test("models.mode = single makes every agent inherit the session model", () => {
  expect(modelFor(config(), "review")).toBe("sonnet");
  expect(modelFor(config('[models]\nmode = "single"\n'), "review")).toBe("inherit");
});

test("autonomy.level = suggest denies every action; safety approvals ask", () => {
  expect(guardCommand(config('[autonomy]\nlevel = "suggest"\n'), "git commit -m x")?.decision).toBe("deny");
  expect(guardCommand(config(), "git reset --hard HEAD~1")?.decision).toBe("ask");
  expect(guardCommand(config(), "terraform apply")?.decision).toBe("ask");
  expect(guardCommand(config(), "cat .env")?.decision).toBe("deny");
  expect(guardCommand(config(), "cat .env.example")).toBeUndefined();
  expect(guardCommand(config(), "cat README.md")).toBeUndefined();
  // Weakening safety is allowed only outside the committed layer; the override layer works in tests.
  const relaxed = resolve(mkdtempSync(join(tmpdir(), "saw-set-")), {
    "safety.destructive_approval": false,
    "safety.deploy_approval": false,
    "safety.no_secrets": false,
  }).config;
  expect(guardCommand(relaxed, "git reset --hard HEAD~1")).toBeUndefined();
  expect(guardCommand(relaxed, "terraform apply")).toBeUndefined();
  expect(guardCommand(relaxed, "cat .env")).toBeUndefined();
});

test("edit_global guards edits under ~/.claude and ~/.saw", () => {
  const home = homedir();
  expect(guardEdit(config(), join(home, ".claude", "CLAUDE.md"))?.decision).toBe("deny");
  expect(guardEdit(config(), join(home, "project", "a.ts"))).toBeUndefined();
  expect(guardEdit(config('[autonomy.actions]\nedit_global = "ask"\n'), join(home, ".saw", "config.toml"))?.decision).toBe("ask");
  expect(guardEdit(config('[autonomy.actions]\nedit_global = "allow"\n'), join(home, ".saw", "config.toml"))).toBeUndefined();
});

test("edit_global leaves Claude Code's own plan and memory files alone", () => {
  const home = homedir();
  expect(guardEdit(config(), join(home, ".claude", "plans", "a-plan.md"))).toBeUndefined();
  expect(guardEdit(config(), join(home, ".claude", "projects", "C--repo", "memory", "MEMORY.md"))).toBeUndefined();
  // Only those files: settings, hooks, skills and anything climbing out stay guarded.
  expect(guardEdit(config(), join(home, ".claude", "plans", "..", "settings.json"))?.decision).toBe("deny");
  expect(guardEdit(config(), join(home, ".claude", "plans", "x", "hook.cjs"))?.decision).toBe("deny");
  expect(guardEdit(config(), join(home, ".claude", "projects", "C--repo", "settings.json"))?.decision).toBe("deny");
  expect(guardEdit(config(), join(home, ".claude", "skills", "a", "SKILL.md"))?.decision).toBe("deny");
  expect(guardEdit(config(), join(home, ".saw", "plans", "a.md"))?.decision).toBe("deny");
});

test("format_hook off, or a format command from the committed layer, runs nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "saw-set-"));
  const c = config('[checks]\nformat = "exit 3"\n');
  expect(formatHook(dir, c, { tool_name: "Edit" }, "local")).toBeDefined();
  expect(formatHook(dir, c, { tool_name: "Edit" }, "project")).toBeUndefined();
  expect(formatHook(dir, config('[checks]\nformat = "exit 3"\n[features]\nformat_hook = false\n'), { tool_name: "Edit" }, "local")).toBeUndefined();
});

test("obsidian, dashboard, audit, metrics and retro toggles change the CLI", async () => {
  const { run } = await import("../src/main");
  const dir = mkdtempSync(join(tmpdir(), "saw-set-cli-"));
  writeFileSync(join(dir, "workflow.toml"), '[verify]\nmode = "hard"\nallow_unconfigured = ["test"]\n');
  expect(run(["dashboard"], dir)).toBe(0);
  expect(run(["dashboard", "--set", "features.dashboard=false"], dir)).toBe(1);
  expect(run(["vault", "sync", "--dry-run", "--set", "features.obsidian=false"], dir)).toBe(1);
  expect(run(["task", "start", "--tier", "standard", "--playbook", "audit", "--set", "features.audit=false"], dir)).toBe(1);
  expect(run(["task", "start", "--tier", "standard", "--playbook", "audit"], dir)).toBe(0);
  // A standard audit task has checks that never ran: ending it needs a reason.
  expect(run(["task", "end", "--set", "features.metrics=false"], dir)).toBe(1);
  expect(run(["task", "end", "--reason", "settings test", "--set", "features.metrics=false"], dir)).toBe(0);
  expect(readdirSync(join(dir, ".saw"))).not.toContain("metrics.jsonl");
  expect(run(["task", "start", "--tier", "trivial", "--playbook", "feature"], dir)).toBe(0);
  expect(run(["task", "end"], dir)).toBe(0);
  expect(readdirSync(join(dir, ".saw"))).toContain("metrics.jsonl");
  expect(run(["retro", "--dry-run", "--set", "features.retro=false"], dir)).toBe(1);
});
