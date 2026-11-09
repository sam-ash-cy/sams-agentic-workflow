// `saw mods check`: validates and tests every mod under mods/ with the claude
// CLI (`claude plugin validate`, then `claude plugin test` when it has tests).

import { existsSync, readdirSync } from "node:fs";
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
