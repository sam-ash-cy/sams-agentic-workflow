// `saw deps`: third-party skills pinned by SHA in deps.lock.toml, with a
// licence allow-list and a named reviewer for every pin: a third-party skill
// can run commands, so every update is reviewed before it is pinned.

import { existsSync, writeFileSync } from "node:fs";
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

// saw doctor: ECC's GateGuard (Fact-Forcing Gate) blocks first shell and edit
// calls until the agent restates facts, which duplicates saw guard and costs a
// round trip per file. Warn while ECC is installed and the gate is still on.
export function gateguardWarning(installedJson: string | undefined, settingsJson: string | undefined, envValue: string | undefined): string | undefined {
  let installed = false;
  let setting: unknown;
  try {
    installed = Object.keys((installedJson ? JSON.parse(installedJson).plugins : undefined) ?? {}).some((k) => k.startsWith("ecc@"));
    setting = settingsJson ? JSON.parse(settingsJson).env?.ECC_GATEGUARD : undefined;
  } catch {
    return undefined;
  }
  if (!installed || envValue === "off" || setting === "off") return undefined;
  return 'ECC is installed with GateGuard on; it duplicates saw guard. Add "ECC_GATEGUARD": "off" to env in ~/.claude/settings.json (docs/COMMANDS.md, Optional extras)';
}

// saw doctor with features.ecc on: ECC is a whole Claude Code plugin, so it is
// checked in installed_plugins.json, not as a skill folder. A different commit
// from the pin is reported too: hooks there were not reviewed.
export function eccProblem(installedJson: string | undefined, pinnedSha: string | undefined): string | undefined {
  let plugins: Record<string, { gitCommitSha?: string }[]> = {};
  try {
    plugins = installedJson ? (JSON.parse(installedJson).plugins ?? {}) : {};
  } catch {
    return "features.ecc is on but installed_plugins.json isn't valid JSON";
  }
  const key = Object.keys(plugins).find((k) => k.startsWith("ecc@"));
  if (!key) return "features.ecc is on but the ecc plugin isn't installed: `claude plugin install ecc@sams-agentic-workflow` (docs/COMMANDS.md, Optional extras), or set features.ecc false";
  const sha = plugins[key]?.[0]?.gitCommitSha;
  if (pinnedSha && sha && sha !== pinnedSha) return `ecc plugin (${key}) is at ${sha.slice(0, 12)}, not the pinned ${pinnedSha.slice(0, 12)}: review with saw deps diff ecc ${sha}, or reinstall from the pin`;
  return undefined;
}

// Companion plugins are soft dependencies on purpose. An unsatisfied plugin.json
// "dependencies" entry makes Claude Code refuse to load saw at all (no hooks,
// skills or agents), so a missing companion only costs the features that use
// it, and session-start says which and how to fix it.
export const COMPANIONS: Record<string, string[]> = {
  "mattpocock-skills": ["grilling", "tdd"],
  engineering: ["docs_step"],
};

export function companionWarnings(installedJson: string | undefined, features: Record<string, boolean>): string[] {
  let plugins: string[];
  try {
    plugins = Object.keys((installedJson ? JSON.parse(installedJson).plugins : undefined) ?? {});
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const [name, uses] of Object.entries(COMPANIONS)) {
    const on = uses.filter((f) => features[f]);
    if (on.length === 0 || plugins.some((k) => k.startsWith(`${name}@`))) continue;
    out.push(`the ${name} plugin isn't installed, so ${on.map((f) => `features.${f}`).join(" and ")} can't run: \`claude plugin install ${name}@sams-agentic-workflow\`, or turn ${on.length > 1 ? "them" : "it"} off`);
  }
  return out;
}
