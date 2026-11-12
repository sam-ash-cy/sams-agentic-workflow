// `saw mods check`: validates and tests every mod under mods/ with the claude
// CLI (`claude plugin validate`, then `claude plugin test` when it has tests).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ModResult {
  name: string;
  validate: number;
  test: number | null; // null: the mod has no tests
}

type Spawn = (cmd: string[]) => number;

export function listMods(root: string): string[] {
  const dir = join(root, "mods");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, ".claude-plugin", "plugin.json")))
    .map((d) => d.name)
    .sort();
}

function hasTests(dir: string): boolean {
  const t = join(dir, "tests");
  return existsSync(t) && readdirSync(t).some((f) => /\.test\.tsx?$/.test(f));
}

export function checkMods(root: string, spawn: Spawn, only?: string): ModResult[] {
  return listMods(root)
    .filter((m) => !only || m === only)
    .map((name) => {
      const dir = join(root, "mods", name);
      const validate = spawn(["claude", "plugin", "validate", dir]);
      return { name, validate, test: hasTests(dir) ? spawn(["claude", "plugin", "test", dir]) : null };
    });
}

// The Claude Code setting a mod's on/off state lives in: `enabledPlugins`, keyed
// "<mod>@<marketplace>", true or false, in the user's settings.json and (per project)
// .claude/settings.local.json. A key missing from both means the mod is not installed.
export const MOD_MARKETPLACE = "sams-agentic-workflow";

// Mods the bootstrap installs for everyone; saw doctor treats a missing one as a problem.
// The dashboard pane is the main way to change settings, so it ships by default.
export const DEFAULT_MODS = ["dashboard-pane"];

export interface ModInfo {
  name: string;
  description: string;
  state: "enabled" | "disabled" | "not installed";
  // Set in a project's own file, not just inherited from the user's.
  own: boolean;
  install: string;
}

// The file's text, or undefined when it is not there. One read, no exists-then-read, so the
// file cannot change between the check and the use.
function readIfThere(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

function readPlugins(file: string | undefined): Record<string, unknown> {
  const text = file ? readIfThere(file) : undefined;
  if (text === undefined) return {};
  const data: unknown = JSON.parse(text);
  const plugins = data && typeof data === "object" ? (data as Record<string, unknown>).enabledPlugins : undefined;
  return plugins && typeof plugins === "object" ? (plugins as Record<string, unknown>) : {};
}

function description(root: string, name: string): string {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(root, "mods", name, ".claude-plugin", "plugin.json"), "utf8"));
    return String((manifest as { description?: unknown }).description ?? "");
  } catch {
    return "";
  }
}

// userFile is the user's settings.json; localFile the project's .claude/settings.local.json
// (omit it for the global view). A file that does not parse throws.
export function modStates(root: string, userFile: string, localFile?: string): ModInfo[] {
  const user = readPlugins(userFile);
  const local = readPlugins(localFile);
  return listMods(root).map((name) => {
    const id = `${name}@${MOD_MARKETPLACE}`;
    const value = id in local && typeof local[id] === "boolean" ? local[id] : user[id];
    const state = typeof value !== "boolean" ? "not installed" : value ? "enabled" : "disabled";
    return { name, description: description(root, name), state, own: id in local, install: `claude plugin install ${id}` };
  });
}

// Writes one mod's switch to `file`, leaving the rest of the file as it was. Refuses a mod
// that is not installed (a switch for a plugin Claude has not got would only confuse it) and
// a file that does not parse.
export function setModEnabled(root: string, userFile: string, file: string, name: string, enabled: boolean): { ok: boolean; problem?: string } {
  if (!listMods(root).includes(name)) return { ok: false, problem: `${name} is not a saw mod` };
  const id = `${name}@${MOD_MARKETPLACE}`;
  try {
    if (!(id in readPlugins(userFile))) return { ok: false, problem: `${name} is not installed: ${`claude plugin install ${id}`}` };
    const current = readIfThere(file);
    const data: Record<string, unknown> = current === undefined ? {} : (JSON.parse(current) as Record<string, unknown>);
    if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, problem: `${file} is not a JSON object` };
    const plugins = data.enabledPlugins && typeof data.enabledPlugins === "object" ? (data.enabledPlugins as Record<string, unknown>) : {};
    plugins[id] = enabled;
    data.enabledPlugins = plugins;
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
    return { ok: true };
  } catch (e) {
    return { ok: false, problem: `could not update ${file}: ${(e as Error).message}` };
  }
}
