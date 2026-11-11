import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addProject, inspectProject, listProjects, projectsFile, registerProject, removeProject } from "../src/projects";

const tmp = (): string => mkdtempSync(join(tmpdir(), "saw-proj-"));
function project(toml?: string): string {
  const dir = tmp();
  mkdirSync(join(dir, ".git"));
  if (toml !== undefined) writeFileSync(join(dir, "workflow.toml"), toml);
  return dir;
}

describe("registry", () => {
  test("register is idempotent and keeps the first added date", () => {
    const home = tmp();
    const dir = project("");
    expect(registerProject(dir, home)).toBe(true);
    const first = listProjects(home);
    expect(first).toHaveLength(1);
    expect(registerProject(dir, home)).toBe(true);
    const second = listProjects(home);
    expect(second).toHaveLength(1);
    expect(second[0]!.added).toBe(first[0]!.added);
    expect(second[0]!.name).toBeTruthy();
  });

  test("a broken projects.json never throws", () => {
    const home = tmp();
    writeFileSync(projectsFile(home), "{ not json");
    expect(listProjects(home)).toEqual([]);
    expect(() => registerProject(project(""), home)).not.toThrow();
  });

  test("remove forgets the entry and leaves the folder alone", () => {
    const home = tmp();
    const dir = project("");
    registerProject(dir, home);
    expect(removeProject(dir, home)).toBe(true);
    expect(listProjects(home)).toHaveLength(0);
    expect(readFileSync(join(dir, "workflow.toml"), "utf8")).toBe("");
    expect(removeProject(dir, home)).toBe(false);
  });

  test("add rejects a folder that does not exist", () => {
    const r = addProject(join(tmp(), "nope"), tmp());
    expect(r.ok).toBe(false);
    expect(r.problem).toBeTruthy();
  });

  test("add stores a folder that is not set up, and says so", () => {
    const home = tmp();
    const r = addProject(project(), home);
    expect(r.ok).toBe(true);
    expect(r.inspection?.state).toBe("not set up");
    expect(listProjects(home)).toHaveLength(1);
  });
});

describe("inspectProject", () => {
  test("ready", () => {
    expect(inspectProject(project('[tokens]\nmode = "soft"\n')).state).toBe("ready");
  });
  test("not set up", () => {
    expect(inspectProject(project()).state).toBe("not set up");
  });
  test("broken settings", () => {
    const r = inspectProject(project("[tokens\nmode = "));
    expect(r.state).toBe("broken settings");
    expect(r.problems.length).toBeGreaterThan(0);
  });
  test("missing", () => {
    expect(inspectProject(join(tmp(), "gone")).state).toBe("missing");
  });
});
