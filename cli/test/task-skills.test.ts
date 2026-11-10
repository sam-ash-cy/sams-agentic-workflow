import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { missingSkillPlugins } from "../src/recommend";
import { taskSkills, taskSteps } from "../src/task";

function config(toml = ""): ReturnType<typeof resolve>["config"] {
  const dir = mkdtempSync(join(tmpdir(), "saw-ts-"));
  writeFileSync(join(dir, "workflow.toml"), toml);
  const none = join(dir, "none.toml");
  return resolve(dir, {}, { global: none, project: none, local: join(dir, "workflow.toml") }).config;
}

test("taskSkills: playbook skills, plus plan skills on complex and critical", () => {
  expect(taskSkills(config(), "standard", "debug")).toContain("mattpocock-skills:diagnosing-bugs");
  expect(taskSkills(config(), "standard", "feature")).not.toContain("mattpocock-skills:grilling");
  expect(taskSkills(config(), "complex", "feature")).toContain("mattpocock-skills:grilling");
  expect(taskSkills(config('[task_skills]\nfeature = ["my-skill"]\n'), "standard", "feature")).toEqual(["my-skill"]);
});

test("taskSteps lists them except on trivial or when off", () => {
  expect(taskSteps(config(), "standard", "debug").join(" ")).toContain("skills that fit");
  expect(taskSteps(config(), "trivial", "debug").join(" ")).not.toContain("skills that fit");
  expect(taskSteps(config("[features]\ntask_skills = false\n"), "standard", "debug").join(" ")).not.toContain("skills that fit");
});

test("missingSkillPlugins names plugins not installed", () => {
  const inst = { mcp: new Set<string>(), plugins: new Set(["engineering"]) };
  expect(missingSkillPlugins(["engineering:debug", "mattpocock-skills:tdd", "appsec-review"], inst)).toEqual(["mattpocock-skills"]);
});
