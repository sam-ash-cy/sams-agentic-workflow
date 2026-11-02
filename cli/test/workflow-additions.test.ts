import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { layerPaths, resolve } from "../src/config";
import { gateguardWarning } from "../src/deps";
import { docsPluginProblem, run } from "../src/main";
import { applyProfile, parseProfiles } from "../src/profiles";
import { configSuggestions } from "../src/retro";
import { FEATURE_SKILLS } from "../src/skills";
import { currentTask, gate, recordCheck, startTask, taskChecks, taskSteps } from "../src/task";
import type { TaskMetric } from "../src/metrics";

const ROOT = join(import.meta.dir, "..", "..");
const PROFILES = parseProfiles(readFileSync(join(ROOT, "docs", "COMMANDS.md"), "utf8"));
const MECHANICAL = ["format", "lint", "typecheck", "test"];

function project(toml = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "saw-add-"));
  writeFileSync(join(dir, "workflow.toml"), toml);
  return dir;
}
const config = (dir: string) => resolve(dir, {}, layerPaths(dir)).config;
const checks = `[checks]\n${MECHANICAL.map((c) => `${c} = "echo ok"`).join("\n")}\n`;

test("docs is a required judgement check for feature and foundation work only", () => {
  const c = config(project());
  expect(taskChecks(c, "standard", "feature")).toContain("docs");
  expect(taskChecks(c, "critical", "foundation")).toContain("docs");
  expect(taskChecks(c, "standard", "debug")).not.toContain("docs");
  expect(taskChecks(c, "trivial", "feature")).not.toContain("docs");
  expect(taskSteps(c, "standard", "feature").join(" ")).toContain("saw task record docs pass");
  expect(taskChecks(config(project("[features]\ndocs_step = false\n")), "standard", "feature")).not.toContain("docs");
  expect(FEATURE_SKILLS.docs_step).toEqual(["engineering:documentation"]);
});

// Every combination of the toggles that decide the required checks, against
// two tiers and a playbook that does and doesn't deliver docs: the gate must
// block until exactly those checks pass, then let the stop through.
test("combination matrix: review and docs toggles x tier x playbook", () => {
  const toggles = ["code_review", "security_review", "docs_step"];
  for (let mask = 0; mask < 1 << toggles.length; mask++) {
    const on = (t: string): boolean => Boolean(mask & (1 << toggles.indexOf(t)));
    const features = toggles.map((t) => `${t} = ${on(t)}`).join("\n");
    for (const tier of ["standard", "complex"]) {
      for (const playbook of ["feature", "debug"]) {
        const dir = project(`${checks}[features]\n${features}\n`);
        const c = config(dir);
        const want = taskChecks(c, tier, playbook);
        expect(want.includes("code_review")).toBe(on("code_review"));
        expect(want.includes("security_review")).toBe(on("security_review"));
        expect(want.includes("docs")).toBe(on("docs_step") && playbook === "feature");
        startTask(dir, tier, playbook);
        for (const name of want) {
          expect(gate(dir, c, {})?.decision).toBe("block");
          recordCheck(dir, { name, status: "pass", how: MECHANICAL.includes(name) ? "ran" : "recorded" });
        }
        expect(gate(dir, c, {})).toBeUndefined();
      }
    }
  }
});

test("every profile in the docs parses into the layers it names", () => {
  const byName = Object.fromEntries(PROFILES.map((p) => [p.name, p.blocks.map((b) => b.layer)]));
  expect(byName).toEqual({ solo: ["local", "project"], team: ["project"], strict: ["project"], autopilot: ["local"] });
});

test("profile apply merges into a saw init workflow.toml, twice, without redefining a table (B3)", () => {
  for (const profile of PROFILES) {
    const dir = mkdtempSync(join(tmpdir(), "saw-profile-"));
    expect(run(["init"], dir)).toBe(0);
    const paths = { ...layerPaths(dir), global: join(dir, "global.toml") };
    for (let i = 0; i < 2; i++) {
      for (const r of applyProfile(dir, profile, false, paths)) expect(r.problems).toEqual([]);
    }
    const resolved = resolve(dir, {}, paths);
    expect(resolved.warnings).toEqual([]);
    for (const b of profile.blocks) {
      for (const k of Object.keys(b.values)) expect([k, resolved.sources[k]]).toEqual([k, b.layer]);
    }
  }
});

test("profile apply --dry-run writes nothing; an unknown profile fails", () => {
  const dir = project("");
  expect(run(["profile", "apply", "strict", "--dry-run"], dir)).toBe(0);
  expect(readFileSync(join(dir, "workflow.toml"), "utf8")).toBe("");
  expect(run(["profile", "apply", "nope"], dir)).toBe(1);
});

test("explain shows each layer, and task adhoc opens a trivial task", () => {
  const dir = project('[tokens]\nmode = "hard"\n');
  expect(run(["explain", "tokens.mode"], dir)).toBe(0);
  expect(run(["explain", "no.such.key"], dir)).toBe(1);
  expect(run(["task", "adhoc"], dir)).toBe(0);
  expect(currentTask(dir)?.tier).toBe("trivial");
});

test("doctor: engineering plugin for the docs step, and the GateGuard warning", () => {
  const c = config(project());
  const eng = (status: string): string => `  ❯ sams-agentic-workflow@sams-agentic-workflow\n    Status: ✔ enabled\n\n  ❯ engineering@sams-agentic-workflow\n    Status: ${status}\n`;
  expect(docsPluginProblem(eng("✔ enabled"), c)).toBeUndefined();
  expect(docsPluginProblem(eng("✘ disabled"), c)).toContain("disabled");
  expect(docsPluginProblem("  ❯ sams-agentic-workflow@sams-agentic-workflow\n", c)).toContain("not installed");
  expect(docsPluginProblem("", config(project("[features]\ndocs_step = false\n")))).toBeUndefined();

  const ecc = JSON.stringify({ plugins: { "ecc@ecc": [{}] } });
  expect(gateguardWarning(ecc, "{}", undefined)).toContain("ECC_GATEGUARD");
  expect(gateguardWarning(ecc, JSON.stringify({ env: { ECC_GATEGUARD: "off" } }), undefined)).toBeUndefined();
  expect(gateguardWarning(ecc, "{}", "off")).toBeUndefined();
  expect(gateguardWarning(JSON.stringify({ plugins: {} }), "{}", undefined)).toBeUndefined();
  expect(gateguardWarning("{", "{}", undefined)).toBeUndefined();
});

test("retro suggests settings from evidence, never below the threshold", () => {
  const m = (tokens: number, findings: Record<string, number> = {}): TaskMetric =>
    ({ at: "2026-11-01T00:00:00Z", tier: "standard", playbook: "feature", label: "Verified", first_pass: true, rework: 0, findings, duration_s: 1, tokens });
  const c = config(project("[features]\ntdd = false\n"));
  expect(configSuggestions([m(400000), m(900000)], c, 3)).toEqual([]);
  const s = configSuggestions([m(400000, { test: 1 }), m(851000, { test: 2 }), m(900000, { test: 1 })], c, 3);
  expect(s[0]).toStartWith("saw config set tokens.budget.standard 860000 --scope local");
  expect(s.some((x) => x.startsWith("saw config set features.tdd true"))).toBe(true);
});
