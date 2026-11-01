// `saw sync`: a plugin can't unload its skills per project, so a disabled
// feature's skills are denied in .claude/settings.json instead. The entries
// saw added are tracked, and only those are ever removed again.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Table } from "./defaults";

export const FEATURE_SKILLS: Record<string, string[]> = {
  grilling: ["mattpocock-skills:grilling"],
  tdd: ["mattpocock-skills:tdd"],
  retro: ["sams-agentic-workflow:retro-promote"],
};

const TRACK = join(".saw", "skill-denies.json");

export function syncSkillDenies(cwd: string, config: Table, dryRun = false): { added: string[]; removed: string[] } {
  const features = (config.features ?? {}) as Record<string, boolean>;
  const want = Object.entries(FEATURE_SKILLS)
    .filter(([f]) => features[f] === false)
    .flatMap(([, skills]) => skills.map((s) => `Skill(${s})`));
  const path = join(cwd, ".claude", "settings.json");
  let settings: { permissions?: { deny?: string[] } } = {};
  if (existsSync(path)) {
    try {
      settings = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      throw new Error(".claude/settings.json isn't valid JSON; fix it, then re-run saw sync");
    }
  }
  const trackPath = join(cwd, TRACK);
  const ours = existsSync(trackPath) ? (JSON.parse(readFileSync(trackPath, "utf8")) as string[]) : [];
  const deny = settings.permissions?.deny ?? [];
  const removed = ours.filter((e) => !want.includes(e) && deny.includes(e));
  // An entry the user already had stays theirs: not added, so never removed.
  const added = want.filter((e) => !deny.includes(e));
  const nowOurs = [...ours.filter((e) => want.includes(e) && deny.includes(e)), ...added];
  if (dryRun) return { added, removed };
  if (added.length || removed.length) {
    settings.permissions = { ...settings.permissions, deny: [...deny.filter((e) => !removed.includes(e)), ...added] };
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
  }
  if (nowOurs.length) {
    mkdirSync(join(cwd, ".saw"), { recursive: true });
    writeFileSync(trackPath, JSON.stringify(nowOurs, null, 2) + "\n");
  } else rmSync(trackPath, { force: true });
  return { added, removed };
}
