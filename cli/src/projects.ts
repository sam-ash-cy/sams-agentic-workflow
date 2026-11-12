// Registry of the projects saw has been used in, kept in ~/.saw/projects.json (SAW_HOME
// respected). It only remembers folders: removing an entry never touches the folder.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve as resolvePath } from "node:path";
import { DEFAULTS } from "./defaults";
import { logEvent } from "./events";
import { layerPaths, resolve } from "./config";
import { parseToml } from "./toml";

export interface Project {
  path: string;
  name: string;
  added: string;
  last_seen: string;
}

export type ProjectState = "ready" | "not set up" | "broken settings" | "missing";

export interface Inspection {
  state: ProjectState;
  git: boolean;
  problems: string[];
  warnings: string[];
}

export interface AddResult {
  ok: boolean;
  problem?: string;
  project?: Project;
  inspection?: Inspection;
}

export const sawHome = (): string => process.env.SAW_HOME ?? join(homedir(), ".saw");
export const projectsFile = (home = sawHome()): string => join(home, "projects.json");

// Compared case-insensitively on Windows, where C:\Work and c:\work are the same folder.
export const sameFolder = (a: string, b: string): boolean => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

export function listProjects(home = sawHome()): Project[] {
  try {
    const data: unknown = JSON.parse(readFileSync(projectsFile(home), "utf8"));
    if (!Array.isArray(data)) return [];
    return data.filter((p): p is Project => !!p && typeof p.path === "string" && typeof p.name === "string");
  } catch {
    return [];
  }
}

function save(list: Project[], home: string): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(projectsFile(home), JSON.stringify(list, null, 2) + "\n");
}

// Called by saw init and saw task start. It must never fail them: any error is logged and
// swallowed, and a projects.json that cannot be parsed is rebuilt from this one entry.
export function registerProject(cwd: string, home = sawHome()): boolean {
  try {
    const path = resolvePath(cwd);
    const now = new Date().toISOString();
    const list = listProjects(home);
    const at = list.findIndex((p) => sameFolder(p.path, path));
    if (at >= 0) list[at] = { ...list[at]!, last_seen: now };
    else list.push({ path, name: basename(path) || path, added: now, last_seen: now });
    save(list, home);
    return true;
  } catch (e) {
    try {
      logEvent(cwd, DEFAULTS, "warn", "projects.register", `could not register project: ${(e as Error).message}`);
    } catch {
      // logging is best effort too
    }
    return false;
  }
}

export function removeProject(path: string, home = sawHome()): boolean {
  const target = resolvePath(path);
  const list = listProjects(home);
  const kept = list.filter((p) => !sameFolder(p.path, target));
  if (kept.length === list.length) return false;
  save(kept, home);
  return true;
}

// The scan behind "add a project": is the folder there, is it a saw project, do its settings load.
export function inspectProject(path: string): Inspection {
  const out: Inspection = { state: "ready", git: false, problems: [], warnings: [] };
  let isDir = false;
  try {
    isDir = statSync(path).isDirectory();
  } catch {
    // not there
  }
  if (!isDir) return { ...out, state: "missing", problems: [`${path} is not a folder`] };
  out.git = existsSync(join(path, ".git"));
  const paths = layerPaths(path);
  if (!existsSync(paths.project)) {
    return { ...out, state: "not set up", problems: ["no workflow.toml here: run saw init"] };
  }
  for (const [layer, file] of [["project", paths.project], ["local", paths.local]] as const) {
    if (!existsSync(file)) continue;
    try {
      parseToml(readFileSync(file, "utf8"));
    } catch (e) {
      out.problems.push(`${layer} settings do not parse: ${(e as Error).message}`);
    }
  }
  if (out.problems.length) return { ...out, state: "broken settings" };
  try {
    out.warnings = resolve(path).warnings;
  } catch (e) {
    return { ...out, state: "broken settings", problems: [(e as Error).message] };
  }
  return out;
}

// Add by hand: resolve the path, scan it, then remember it. A folder that is not set up is
// still stored so it shows in the list with its state; the caller offers to set it up.
export function addProject(path: string, home = sawHome()): AddResult {
  const full = resolvePath(path);
  const inspection = inspectProject(full);
  if (inspection.state === "missing") return { ok: false, problem: inspection.problems[0], inspection };
  if (!registerProject(full, home)) return { ok: false, problem: "could not write projects.json", inspection };
  const project = listProjects(home).find((p) => sameFolder(p.path, full));
  return { ok: true, project, inspection };
}
