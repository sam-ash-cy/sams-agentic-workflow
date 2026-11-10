// `saw sync`: a plugin can't unload its skills per project, so a disabled
// feature's skills are denied in .claude/settings.json instead. The entries
// saw added are tracked, and only those are ever removed again.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULTS, type Table } from "./defaults";
import { readIfExists } from "./fs";

export const FEATURE_SKILLS: Record<string, string[]> = {
  grilling: ["mattpocock-skills:grilling"],
  tdd: ["mattpocock-skills:tdd"],
  retro: ["sams-agentic-workflow:retro-promote"],
  unslop: ["unslop"],
  brag: ["brag", "brag-slim"],
  docs_step: ["engineering:documentation"],
  about_me: ["sams-agentic-workflow:about-me"],
};

const TRACK = join(".saw", "skill-denies.json");

export function syncSkillDenies(cwd: string, config: Table, dryRun = false): { added: string[]; removed: string[] } {
  const features = (config.features ?? {}) as Record<string, boolean>;
  const want = Object.entries(FEATURE_SKILLS)
    .filter(([f]) => features[f] === false)
    .flatMap(([, skills]) => skills.map((s) => `Skill(${s})`));
  const path = join(cwd, ".claude", "settings.json");
  let settings: { permissions?: { deny?: string[] } } = {};
  const raw = readIfExists(path);
  if (raw !== undefined) {
    try {
      settings = JSON.parse(raw);
    } catch {
      throw new Error(".claude/settings.json isn't valid JSON; fix it, then re-run saw sync");
    }
  }
  const trackPath = join(cwd, TRACK);
  let ours: string[] = [];
  try {
    ours = JSON.parse(readFileSync(trackPath, "utf8")) as string[];
  } catch {
    // Missing or corrupt tracking file: forget what we added; entries already in settings.json stay.
  }
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

// features.advisor: Claude Code's advisorModel in .claude/settings.local.json,
// from [advisor].model. A value the user set by hand is left alone; saw only
// changes or removes the one it wrote (.saw/advisor.json).
const ADVISOR_TRACK = join(".saw", "advisor.json");

// [advisor].model, or the built-in default when blank.
export const advisorModel = (config: Table): string => ((config.advisor ?? {}) as { model?: string }).model?.trim() || String((DEFAULTS.advisor as Table).model);

export function syncAdvisor(cwd: string, config: Table, dryRun = false): { from?: string; to?: string; changed: boolean; kept?: string } {
  const on = ((config.features ?? {}) as Record<string, boolean>).advisor !== false;
  const want = on ? advisorModel(config) : undefined;
  const path = join(cwd, ".claude", "settings.local.json");
  let settings: { advisorModel?: string } & Record<string, unknown> = {};
  const raw = readIfExists(path);
  if (raw !== undefined) {
    try {
      settings = JSON.parse(raw);
    } catch {
      throw new Error(".claude/settings.local.json isn't valid JSON; fix it, then re-run saw sync");
    }
  }
  let ours: string | undefined;
  try {
    ours = (JSON.parse(readFileSync(join(cwd, ADVISOR_TRACK), "utf8")) as { model?: string }).model;
  } catch {
    // No record: saw wrote nothing yet.
  }
  const current = settings.advisorModel;
  if (current !== undefined && current !== ours) return { from: current, to: current, changed: false, kept: current };
  if (current === want) return { from: current, to: want, changed: false };
  if (dryRun) return { from: current, to: want, changed: true };
  if (want) settings.advisorModel = want;
  else delete settings.advisorModel;
  mkdirSync(join(cwd, ".claude"), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
  if (want) {
    mkdirSync(join(cwd, ".saw"), { recursive: true });
    writeFileSync(join(cwd, ADVISOR_TRACK), JSON.stringify({ model: want }) + "\n");
  } else rmSync(join(cwd, ADVISOR_TRACK), { force: true });
  return { from: current, to: want, changed: true };
}
