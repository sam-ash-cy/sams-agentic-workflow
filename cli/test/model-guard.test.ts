import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { guardHook } from "../src/guard";
import { guardAgent, implementerEdit, planModelWarning } from "../src/model-guard";
import { setPhase, startTask } from "../src/task";

const tmp = (p: string): string => mkdtempSync(join(tmpdir(), p));

function config(toml = ""): ReturnType<typeof resolve>["config"] {
  const dir = tmp("saw-mg-");
  writeFileSync(join(dir, "workflow.toml"), toml);
  const none = join(dir, "none.toml");
  return resolve(dir, {}, { global: none, project: none, local: join(dir, "workflow.toml") }).config;
}

function plugin(agents: Record<string, string>): string {
  const dir = tmp("saw-mg-plugin-");
  mkdirSync(join(dir, "agents"));
  for (const [name, fm] of Object.entries(agents)) writeFileSync(join(dir, "agents", `${name}.md`), `---\nname: ${name}\n${fm}\n---\nbody\n`);
  return dir;
}

const p = plugin({ implementer: "role: implement\nmodel: sonnet", "code-reviewer": "role: review\nmodel: sonnet", helper: "model: haiku" });

test("a saw agent on the wrong model is denied with the right one named", () => {
  const c = config();
  // Defaults: implement = strong = opus; the agent file says sonnet.
  expect(guardAgent(c, { subagent_type: "implementer" }, p)).toContain('pass model: "opus"');
  expect(guardAgent(c, { subagent_type: "sams-agentic-workflow:implementer", model: "haiku" }, p)).toContain("models.roles.implement is opus");
  expect(guardAgent(c, { subagent_type: "implementer", model: "opus" }, p)).toBeUndefined();
  expect(guardAgent(c, { subagent_type: "code-reviewer" }, p)).toBeUndefined();
  expect(guardAgent(c, { subagent_type: "code-reviewer", model: "claude-sonnet-5-5" }, p)).toBeUndefined();
});

test("non-saw agents, agents without a role and single mode are left alone", () => {
  expect(guardAgent(config(), { subagent_type: "Explore", model: "haiku" }, p)).toBeUndefined();
  expect(guardAgent(config(), { subagent_type: "helper" }, p)).toBeUndefined();
  expect(guardAgent(config(), { subagent_type: "../evil" }, p)).toBeUndefined();
  expect(guardAgent(config('[models]\nmode = "single"\n'), { subagent_type: "implementer", model: "haiku" }, p)).toBeUndefined();
  expect(guardAgent(config('[models.roles]\nimplement = "mid"\n'), { subagent_type: "implementer" }, p)).toBeUndefined();
});

test("guardHook denies the Agent tool on a wrong model (real agent files)", () => {
  const out = guardHook(config(), { tool_name: "Agent", tool_input: { subagent_type: "security-reviewer", model: "haiku" } });
  expect(JSON.stringify(out)).toContain('"permissionDecision":"deny"');
  expect(JSON.stringify(out)).toContain("models.roles.security_review");
});

function project(): string {
  const dir = tmp("saw-mg-proj-");
  writeFileSync(join(dir, "workflow.toml"), "");
  return dir;
}

test("main-session source edits: denied in the implement phase, asked otherwise", () => {
  const c = config("[features]\nimplementer = true\n");
  const dir = project();
  const edit = (file: string, agent_id?: string) => implementerEdit(c, { agent_id, tool_input: { file_path: join(dir, file) } }, dir);
  expect(edit("src/app.ts")).toBeUndefined(); // no task open
  startTask(dir, "standard", "feature");
  expect(edit("src/app.ts")?.decision).toBe("ask");
  setPhase(dir, "implement");
  const v = edit("src/app.ts");
  expect(v?.decision).toBe("deny");
  expect(v?.reason).toContain('implementer agent with model: "opus"');
  expect(edit("src/app.ts", "agent-123")).toBeUndefined(); // the implementer itself
  expect(edit("docs/plan.md")).toBeUndefined();
  expect(edit("README.md")).toBeUndefined();
  expect(edit("workflow.toml")).toBeUndefined();
  expect(implementerEdit(c, { tool_input: { file_path: join(tmpdir(), "elsewhere.ts") } }, dir)).toBeUndefined();
  // Through the hook: deny beats the edit guard's allow.
  expect(JSON.stringify(guardHook(c, { tool_name: "Write", tool_input: { file_path: join(dir, "src/app.ts") } }, dir))).toContain('"permissionDecision":"deny"');
});

test("the implementer guard is off with the feature off or on trivial tasks", () => {
  const dir = project();
  startTask(dir, "standard", "feature");
  setPhase(dir, "implement");
  expect(implementerEdit(config(), { tool_input: { file_path: join(dir, "a.ts") } }, dir)).toBeUndefined();
  const trivial = project();
  startTask(trivial, "trivial", "feature");
  expect(implementerEdit(config("[features]\nimplementer = true\n"), { tool_input: { file_path: join(trivial, "a.ts") } }, trivial)).toBeUndefined();
  expect(() => setPhase(dir, "ship")).toThrow("phase must be one of");
});

test("session start warns only when models.roles.plan is set and differs", () => {
  expect(planModelWarning(config(), { model: "claude-sonnet-5-5" })).toBeUndefined();
  const c = config('[models.roles]\nplan = "strong"\n');
  expect(planModelWarning(c, { model: "claude-opus-5-5" })).toBeUndefined();
  expect(String(planModelWarning(c, { model: "claude-sonnet-5-5" })?.systemMessage)).toContain("models.roles.plan is opus");
  expect(planModelWarning(c, {})).toBeUndefined();
});
