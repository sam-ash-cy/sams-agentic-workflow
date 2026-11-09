import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { phaseSetting, sessionSettings, syncAgents, syncSession } from "../src/agents";
import { isKnownKey, resolve } from "../src/config";
import { guardAgent, planModelWarning } from "../src/model-guard";

const tmp = (p: string): string => mkdtempSync(join(tmpdir(), p));

function config(toml = ""): ReturnType<typeof resolve>["config"] {
  const dir = tmp("saw-pm-");
  writeFileSync(join(dir, "workflow.toml"), toml);
  const none = join(dir, "none.toml");
  return resolve(dir, {}, { global: none, project: none, local: join(dir, "workflow.toml") }).config;
}

const PHASES = `
[models.phases.plan]
model = "opus"
effort = "low"
[models.phases.implement]
model = "mid"
effort = "medium"
[models.phases.implement.critical]
model = "strong"
effort = "high"
[models.phases.review]
effort = "bogus"
`;

test("phase settings: tier beats phase beats roles; aliases resolve; bad effort dropped", () => {
  const c = config(PHASES);
  expect(phaseSetting(c, "implement")).toEqual({ model: "sonnet", effort: "medium" });
  expect(phaseSetting(c, "implement", "standard")).toEqual({ model: "sonnet", effort: "medium" });
  expect(phaseSetting(c, "implement", "critical")).toEqual({ model: "opus", effort: "high" });
  expect(phaseSetting(c, "plan")).toEqual({ model: "opus", effort: "low" });
  expect(phaseSetting(c, "review")).toEqual({ model: "sonnet", effort: undefined }); // falls back to roles.review = mid
  expect(phaseSetting(config(), "implement")).toEqual({ model: "opus", effort: undefined });
  expect(phaseSetting(config(`[models]\nmode = "single"\n${PHASES}`), "implement").model).toBe("inherit");
});

test("models.phases keys are known; others are not", () => {
  expect(isKnownKey("models.phases.plan.model")).toBe(true);
  expect(isKnownKey("models.phases.implement.critical.effort")).toBe(true);
  expect(isKnownKey("models.phases.implement.huge.effort")).toBe(false);
  expect(isKnownKey("models.phases.plan.temperature")).toBe(false);
});

test("sync writes effort into agent frontmatter and removes it when unset", () => {
  const dir = tmp("saw-pm-plugin-");
  mkdirSync(join(dir, "agents"));
  const file = join(dir, "agents", "implementer.md");
  const original = "---\r\nname: implementer\r\nrole: implement\r\nmodel: opus\r\n---\r\nbody\r\n";
  writeFileSync(file, original);
  expect(syncAgents(dir, config(PHASES))[0]).toMatchObject({ model: "sonnet", effort: "medium", changed: true });
  expect(readFileSync(file, "utf8")).toContain("model: sonnet\r\neffort: medium\r\n");
  expect(syncAgents(dir, config(PHASES))[0]!.changed).toBe(false); // idempotent
  syncAgents(dir, config());
  expect(readFileSync(file, "utf8")).toBe(original);
});

test("session settings: opusplan only for opus plan + sonnet implement; effort from plan", () => {
  expect(sessionSettings(config(PHASES))).toEqual({ model: "opusplan", effortLevel: "low" });
  expect(sessionSettings(config(PHASES), "critical")).toEqual({ effortLevel: "low" }); // implement is opus there
  expect(sessionSettings(config())).toEqual({});
  const cwd = tmp("saw-pm-cwd-");
  mkdirSync(join(cwd, ".claude"));
  const path = join(cwd, ".claude", "settings.local.json");
  writeFileSync(path, JSON.stringify({ permissions: { allow: ["x"] } }));
  expect(syncSession(cwd, config(PHASES), true).changed).toBe(true);
  expect(JSON.parse(readFileSync(path, "utf8")).model).toBeUndefined(); // dry run
  syncSession(cwd, config(PHASES));
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ permissions: { allow: ["x"] }, model: "opusplan", effortLevel: "low" });
  expect(syncSession(cwd, config(PHASES)).changed).toBe(false);
  writeFileSync(path, "{ broken,");
  expect(() => syncSession(cwd, config(PHASES))).toThrow("not valid JSON");
  expect(readFileSync(path, "utf8")).toBe("{ broken,");
});

test("an effort-only plan phase doesn't warn about the model", () => {
  const outside = tmp("saw-pm-out-");
  expect(planModelWarning(config('[models.phases.plan]\neffort = "low"\n'), { model: "claude-opus-5-5" }, outside)).toBeUndefined();
});

test("guard and plan warning name models.phases and accept opusplan", () => {
  const p = tmp("saw-pm-p-");
  mkdirSync(join(p, "agents"));
  writeFileSync(join(p, "agents", "implementer.md"), "---\nrole: implement\nmodel: haiku\n---\n");
  const outside = tmp("saw-pm-out-");
  expect(guardAgent(config(PHASES), { subagent_type: "implementer" }, p, outside)).toContain("models.phases.implement is sonnet");
  expect(planModelWarning(config(PHASES), { model: "opusplan" }, outside)).toBeUndefined();
  expect(String(planModelWarning(config(PHASES), { model: "claude-sonnet-5-5" }, outside)?.systemMessage)).toContain("saw sync --session");
});
