// Model routing for plugin agents (ADR 0012: models live in agent frontmatter).
// Each agent declares its `role:`; sync rewrites its `model:` line from [models].

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Table } from "./defaults";

export function modelFor(config: Table, role: string): string {
  const models = (config.models ?? {}) as Record<string, unknown> & { mode?: string; roles?: Record<string, string> };
  const routing = ((config.features ?? {}) as Record<string, boolean>).model_routing !== false;
  if (models.mode === "single" || !routing) return "inherit";
  const tier = models.roles?.[role] ?? "mid";
  // A role maps to cheap | mid | strong, or straight to a model name.
  return typeof models[tier] === "string" ? (models[tier] as string) : tier;
}

export interface SyncedAgent {
  name: string;
  model: string;
  changed: boolean;
}

export function syncAgents(pluginDir: string, config: Table, dryRun = false): SyncedAgent[] {
  const dir = join(pluginDir, "agents");
  const out: SyncedAgent[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    const path = join(dir, file);
    const text = readFileSync(path, "utf8");
    const role = /^role:[ \t]*(\S+)/m.exec(text)?.[1];
    if (!role) continue;
    const model = modelFor(config, role);
    // [^\r\n] keeps a CRLF line ending intact on Windows checkouts.
    const next = text.replace(/^model:[^\r\n]*/m, `model: ${model}`);
    const changed = next !== text;
    if (changed && !dryRun) writeFileSync(path, next);
    out.push({ name: file.replace(/\.md$/, ""), model, changed });
  }
  return out;
}
