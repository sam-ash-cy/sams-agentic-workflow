// `saw deps`: third-party skills pinned by SHA in deps.lock.toml, with a
// licence allow-list and a named reviewer for every pin: a third-party skill
// can run commands, so every update is reviewed before it is pinned.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Table } from "./defaults";
import { readToml, stringifyToml } from "./toml";

export interface Dep {
  repo: string;
  sha: string;
  licence: string;
  reviewed_by: string;
  reviewed_on: string;
}

export function readLock(path: string): Record<string, Dep> {
  if (!existsSync(path)) return {};
  return readToml(path) as unknown as Record<string, Dep>;
}

export interface Verdict {
  errors: string[];
  pending: string[];
}

export function verifyLock(lock: Record<string, Dep>, allowed: string[]): Verdict {
  const v: Verdict = { errors: [], pending: [] };
  for (const [name, d] of Object.entries(lock)) {
    if (!/^[0-9a-f]{40}$/.test(d.sha ?? "")) v.errors.push(`${name}: sha must be a full 40-character commit hash`);
    if (!allowed.includes(d.licence)) v.errors.push(`${name}: licence "${d.licence}" is not in deps.allowed_licences`);
    if (!/^https:\/\//.test(d.repo ?? "")) v.errors.push(`${name}: repo must be an https URL`);
    if (!d.reviewed_by) v.errors.push(`${name}: reviewed_by is missing`);
    else if (d.reviewed_by === "pending") v.pending.push(`${name}: pin not reviewed yet (saw deps diff, then saw deps pin --reviewed-by <you>)`);
  }
  return v;
}

export function compareUrl(dep: Dep, sha: string): string {
  return `${dep.repo.replace(/\.git$/, "")}/compare/${dep.sha}...${sha}`;
}

export function pin(path: string, name: string, sha: string, reviewer: string, today = new Date().toISOString().slice(0, 10)): void {
  const lock = readLock(path);
  const dep = lock[name];
  if (!dep) throw new Error(`no dependency "${name}" in ${path}`);
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("sha must be a full 40-character commit hash");
  if (!reviewer || reviewer === "pending") throw new Error("--reviewed-by <who> is required");
  lock[name] = { ...dep, sha, reviewed_by: reviewer, reviewed_on: today };
  const header = "# Third-party skills, pinned by commit. Update only via saw deps diff, then saw deps pin.\n\n";
  writeFileSync(path, header + stringifyToml(lock as unknown as Table));
}

// Companion plugins are soft dependencies on purpose. An unsatisfied plugin.json
// "dependencies" entry makes Claude Code refuse to load saw at all (no hooks,
// skills or agents), so a missing companion only costs the features that use
// it, and session-start says which and how to fix it.
export const COMPANIONS: Record<string, string[]> = {
  "mattpocock-skills": ["grilling", "tdd"],
  engineering: ["docs_step"],
};

// The desktop app syncs plugins to <config>/plugins/synced/<account_org>/<uuid>/,
// outside installed_plugins.json; the real name is in .claude-plugin/plugin.json.
export function syncedPluginNames(pluginJsons: string[]): string[] {
  const names: string[] = [];
  for (const text of pluginJsons) {
    try {
      const name = (JSON.parse(text) as { name?: unknown }).name;
      if (typeof name === "string" && name) names.push(name);
    } catch {
      // Unreadable plugin.json: it isn't evidence of anything.
    }
  }
  return names;
}

// Reads <synced>/<account_org>/<uuid>/.claude-plugin/plugin.json; [] when there is no such folder.
export function readSyncedPluginNames(synced: string): string[] {
  const texts: string[] = [];
  try {
    for (const group of readdirSync(synced, { withFileTypes: true })) {
      if (!group.isDirectory()) continue;
      for (const p of readdirSync(join(synced, group.name), { withFileTypes: true })) {
        const manifest = join(synced, group.name, p.name, ".claude-plugin", "plugin.json");
        if (p.isDirectory() && existsSync(manifest)) texts.push(readFileSync(manifest, "utf8"));
      }
    }
  } catch {
    // No synced folder: only installed_plugins.json counts.
  }
  return syncedPluginNames(texts);
}

// extra: names of plugins found installed some other way (see syncedPluginNames).
export function companionWarnings(installedJson: string | undefined, features: Record<string, boolean>, extra: string[] = []): string[] {
  let plugins: string[];
  try {
    plugins = Object.keys((installedJson ? JSON.parse(installedJson).plugins : undefined) ?? {});
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const [name, uses] of Object.entries(COMPANIONS)) {
    const on = uses.filter((f) => features[f]);
    if (on.length === 0 || plugins.some((k) => k.startsWith(`${name}@`)) || extra.includes(name)) continue;
    out.push(`the ${name} plugin isn't installed, so ${on.map((f) => `features.${f}`).join(" and ")} can't run: \`claude plugin install ${name}@sams-agentic-workflow\`, or turn ${on.length > 1 ? "them" : "it"} off`);
  }
  return out;
}
