// Model routing for plugin agents: models live in agent frontmatter.
// Each agent declares its `role:`; sync rewrites its `model:` line from [models].

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Table } from "./defaults";

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

interface PhaseEntry { model?: unknown; effort?: unknown }

// [models.phases.<phase>] and [models.phases.<phase>.<tier>]: the tier entry
// wins, then the phase entry, then models.roles.<phase>.
export function phaseSetting(config: Table, role: string, tier?: string): { model: string; effort?: string } {
  const models = (config.models ?? {}) as Record<string, unknown> & { mode?: string; roles?: Record<string, string>; phases?: Record<string, PhaseEntry & Record<string, PhaseEntry>> };
  const phase = models.phases?.[role];
  const byTier = tier && phase && typeof phase[tier] === "object" ? phase[tier] : undefined;
  const pick = (k: keyof PhaseEntry): string | undefined => {
    const v = byTier?.[k] ?? phase?.[k];
    return typeof v === "string" && v ? v : undefined;
  };
  const e = pick("effort");
  const effort = e && EFFORTS.includes(e) ? e : undefined;
  if (models.mode === "single") return { model: "inherit", effort };
  const alias = pick("model") ?? models.roles?.[role] ?? "mid";
  // A role maps to cheap | mid | strong, or straight to a model name.
  return { model: typeof models[alias] === "string" ? (models[alias] as string) : alias, effort };
}

export function modelFor(config: Table, role: string, tier?: string): string {
  return phaseSetting(config, role, tier).model;
}

export interface SyncedAgent {
  name: string;
  model: string;
  effort?: string;
  changed: boolean;
}

// Main session: plan on opus with implement on sonnet is Claude Code's
// "opusplan" alias, the one pairing a setting can force. Effort comes from the
// plan phase. Only the model and effortLevel keys are set; others are kept.
export function sessionSettings(config: Table, tier?: string): Record<string, string> {
  const plan = phaseSetting(config, "plan", tier);
  const impl = phaseSetting(config, "implement", tier);
  const out: Record<string, string> = {};
  if (/opus/i.test(plan.model) && /sonnet/i.test(impl.model)) out.model = "opusplan";
  if (plan.effort) out.effortLevel = plan.effort;
  return out;
}

export function syncSession(cwd: string, config: Table, dryRun = false): { path: string; set: Record<string, string>; changed: boolean } {
  const path = join(cwd, ".claude", "settings.local.json");
  const set = sessionSettings(config);
  let current: Record<string, unknown> = {};
  let raw: string | undefined;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    // Missing: start from an empty object.
  }
  if (raw !== undefined) {
    // Never overwrite a file we can't parse: it would drop the user's settings.
    try {
      current = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error(`${path} is not valid JSON; fix it before saw sync --session`);
    }
  }
  const changed = Object.entries(set).some(([k, v]) => current[k] !== v);
  if (changed && !dryRun) {
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    writeFileSync(path, JSON.stringify({ ...current, ...set }, null, 2) + "\n");
  }
  return { path, set, changed };
}

export function syncAgents(pluginDir: string, config: Table, dryRun = false): SyncedAgent[] {
  const dir = join(pluginDir, "agents");
  const out: SyncedAgent[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    const path = join(dir, file);
    const text = readFileSync(path, "utf8");
    const role = /^role:[ \t]*(\S+)/m.exec(text)?.[1];
    if (!role) continue;
    const { model, effort } = phaseSetting(config, role);
    // [^\r\n] keeps a CRLF line ending intact on Windows checkouts.
    let next = text.replace(/^model:[^\r\n]*/m, `model: ${model}`);
    if (!effort) next = next.replace(/^effort:[^\r\n]*\r?\n/m, "");
    else if (/^effort:/m.test(next)) next = next.replace(/^effort:[^\r\n]*/m, `effort: ${effort}`);
    else next = next.replace(/^(model:[^\r\n]*)(\r?\n)/m, `$1$2effort: ${effort}$2`);
    const changed = next !== text;
    if (changed && !dryRun) writeFileSync(path, next);
    out.push({ name: file.replace(/\.md$/, ""), model, effort, changed });
  }
  return out;
}
