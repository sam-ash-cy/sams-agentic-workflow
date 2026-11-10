import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { syncAdvisor } from "../src/skills";
import { taskChecks, taskSteps } from "../src/task";

const tmp = (): string => mkdtempSync(join(tmpdir(), "saw-adv-"));
function config(toml = ""): ReturnType<typeof resolve>["config"] {
  const dir = tmp();
  writeFileSync(join(dir, "workflow.toml"), toml);
  const none = join(dir, "none.toml");
  return resolve(dir, {}, { global: none, project: none, local: join(dir, "workflow.toml") }).config;
}
const local = (d: string): Record<string, unknown> => JSON.parse(readFileSync(join(d, ".claude", "settings.local.json"), "utf8"));

test("standard tasks owe the advisor check and name the model", () => {
  expect(taskChecks(config(), "standard", "feature")).toContain("advisor");
  expect(taskChecks(config(), "trivial", "feature")).not.toContain("advisor");
  expect(taskSteps(config('[advisor]\nmodel = "claude-fable-5-2"\n'), "standard").join(" ")).toContain("claude-fable-5-2");
  expect(taskChecks(config("[features]\nadvisor = false\n"), "standard", "feature")).not.toContain("advisor");
});

test("syncAdvisor writes, updates and removes only its own advisorModel", () => {
  const d = tmp();
  expect(syncAdvisor(d, config()).changed).toBe(true);
  expect(local(d).advisorModel).toBe("claude-opus-5-5");
  syncAdvisor(d, config('[advisor]\nmodel = "claude-fable-5-2"\n'));
  expect(local(d).advisorModel).toBe("claude-fable-5-2");
  syncAdvisor(d, config("[features]\nadvisor = false\n"));
  expect(local(d).advisorModel).toBeUndefined();
  const mine = tmp();
  mkdirSync(join(mine, ".claude"));
  writeFileSync(join(mine, ".claude", "settings.local.json"), JSON.stringify({ advisorModel: "sonnet" }));
  expect(syncAdvisor(mine, config()).kept).toBe("sonnet");
  expect(local(mine).advisorModel).toBe("sonnet");
});
