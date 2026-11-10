// [context] autocompact / autocompact_window -> Claude Code's autoCompactEnabled
// and autoCompactWindow settings. Only keys saw sets are written; others kept.
// The track file records what saw wrote, so "inherit" / 0 can take it back out.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Table } from "./defaults";
import { readIfExists } from "./fs";

const KEYS = ["autoCompactEnabled", "autoCompactWindow"] as const;

export function compactSettings(config: Table): { set: Record<string, boolean | number>; warnings: string[] } {
  const c = (config.context ?? {}) as { autocompact?: string; autocompact_window?: number; window_tokens?: number; handoff_at?: number };
  const set: Record<string, boolean | number> = {};
  const warnings: string[] = [];
  if (c.autocompact === "on") set.autoCompactEnabled = true;
  if (c.autocompact === "off") set.autoCompactEnabled = false;
  const w = Number(c.autocompact_window ?? 0);
  if (w) {
    if (w < 100000 || w > 1000000) warnings.push(`context.autocompact_window ${w} is outside 100000-1000000; not written`);
    else {
      set.autoCompactWindow = w;
      const handoff = Math.round((c.handoff_at ?? 0.85) * (c.window_tokens ?? 200000));
      if (c.autocompact !== "off" && w < handoff) warnings.push(`auto-compact at ${w} tokens fires before the handoff nudge (${handoff}); raise autocompact_window or lower context.handoff_at`);
    }
  }
  return { set, warnings };
}

function readJson(path: string): Record<string, unknown> | undefined {
  const raw = readIfExists(path);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`${path} is not valid JSON; fix it before saw sync`);
  }
}

// track: where saw records the keys it wrote to `path`.
export function syncCompact(path: string, track: string, config: Table, dryRun = false): { path: string; set: Record<string, boolean | number>; removed: string[]; changed: boolean; warnings: string[] } {
  const { set, warnings } = compactSettings(config);
  const current = readJson(path) ?? {};
  let ours: Record<string, unknown> = {};
  try {
    ours = readJson(track) ?? {};
  } catch {
    // A broken track file: treat it as nothing written.
  }
  const next: Record<string, unknown> = { ...current, ...set };
  // Keys saw wrote before and no longer sets, still holding saw's value.
  const removed = KEYS.filter((k) => !(k in set) && k in ours && current[k] === ours[k]);
  for (const k of removed) delete next[k];
  const changed = removed.length > 0 || Object.entries(set).some(([k, v]) => current[k] !== v);
  if (dryRun) return { path, set, removed, changed, warnings };
  if (changed) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
  }
  if (Object.keys(set).length) {
    mkdirSync(dirname(track), { recursive: true });
    writeFileSync(track, JSON.stringify(set) + "\n");
  } else rmSync(track, { force: true });
  return { path, set, removed, changed, warnings };
}
