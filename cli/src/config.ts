// Layered settings: defaults < global < project < local < per-task override.
// Values are tracked per dotted key so `saw config show --resolved` can say
// which layer each one came from.

import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { DEFAULTS, ENUMS, type Table, type Value } from "./defaults";
import { readToml } from "./toml";

export type Layer = "default" | "global" | "project" | "local" | "override";

export interface Resolved {
  config: Table;
  sources: Record<string, Layer>;
  warnings: string[];
}

export interface LayerPaths {
  global: string;
  project: string;
  local: string;
}

export function layerPaths(cwd: string, home = process.env.SAW_HOME ?? join(homedir(), ".saw")): LayerPaths {
  return {
    global: join(home, "config.toml"),
    project: join(cwd, "workflow.toml"),
    local: join(cwd, "workflow.local.toml"),
  };
}

function isTable(v: Value | undefined): v is Table {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function flatten(table: Table, prefix = ""): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const [k, v] of Object.entries(table)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isTable(v)) Object.assign(out, flatten(v, key));
    else out[key] = v;
  }
  return out;
}

export function setPath(table: Table, key: string, value: Value): void {
  const parts = key.split(".");
  let node = table;
  for (const part of parts.slice(0, -1)) {
    if (!isTable(node[part])) node[part] = {};
    node = node[part] as Table;
  }
  node[parts[parts.length - 1]!] = value;
}

export function unsetPath(table: Table, key: string): boolean {
  const parts = key.split(".");
  let node: Value | undefined = table;
  for (const part of parts.slice(0, -1)) {
    node = isTable(node) ? node[part] : undefined;
  }
  const last = parts[parts.length - 1]!;
  if (!isTable(node) || !(last in node)) return false;
  delete node[last];
  return true;
}

const DEFAULT_KEYS = flatten(DEFAULTS);

export function isKnownKey(key: string): boolean {
  if (key in DEFAULT_KEYS) return true;
  // Tables whose children are open-ended (per-tier check sets, per-role models).
  return /^verify\.[a-z_]+\.(run|extends)$/.test(key) || /^models\.roles\.[a-z_]+$/.test(key) || /^checks\.[a-z_]+$/.test(key);
}

export function validate(key: string, value: Value): string | undefined {
  if (!isKnownKey(key)) return `unknown key "${key}"`;
  const allowed = ENUMS[key];
  if (allowed && !allowed.includes(String(value))) return `"${key}" must be one of ${allowed.join(" | ")}`;
  if (key.startsWith("checks.") && typeof value !== "string") return `"${key}" must be a command string`;
  // An unknown parent would silently drop every inherited check.
  const tiers = Object.entries((DEFAULTS.verify ?? {}) as Table).filter(([, v]) => isTable(v)).map(([k]) => k);
  if (/^verify\.[a-z_]+\.extends$/.test(key) && !tiers.includes(String(value))) return `"${key}" must be one of ${tiers.join(" | ")}`;
  const def = DEFAULT_KEYS[key];
  if (def !== undefined && typeof def !== typeof value) return `"${key}" must be a ${Array.isArray(def) ? "list" : typeof def}`;
  return undefined;
}

// Safety may only be tightened by the committed project layer. Ranks run from
// strictest (0) upwards; a project value ranked looser than the current one is
// dropped with a warning.
const PUSH_RANK = ["never", "ask", "allow"];

function tightens(key: string, current: Value, next: Value): boolean {
  if (key === "safety.push") return PUSH_RANK.indexOf(String(next)) <= PUSH_RANK.indexOf(String(current));
  const rank = key === "autonomy.level" ? LEVEL_RANK : key.startsWith("autonomy.actions.") ? ACTION_RANK : key === EVIDENCE_KEY ? EVIDENCE_RANK : undefined;
  // An unknown value (indexOf -1) never counts as tightening.
  if (rank) return rank.includes(String(next)) && rank.indexOf(String(next)) <= rank.indexOf(String(current));
  if (LOOSER_WHEN_ON.includes(key)) return next === false || current === true;
  if (typeof current === "boolean") return next === true || current === false;
  return true;
}

// Besides [safety], the keys the guard enforces: a committed workflow.toml (any
// cloned repo) may make these stricter, never looser.
const LEVEL_RANK = ["suggest", "propose", "act"];
const ACTION_RANK = ["never", "ask", "propose", "allow"];
const LOOSER_WHEN_ON = ["features.parallel_sessions", "features.worktrees"];
// A cloned repo may demand review evidence, never waive it.
const EVIDENCE_KEY = "verify.require_review_evidence";
const EVIDENCE_RANK = ["review_session", "agent", "off"];
const guarded = (key: string): boolean => key.startsWith("safety.") || key.startsWith("autonomy.") || LOOSER_WHEN_ON.includes(key) || key === EVIDENCE_KEY;
// Whether the project layer would ignore this value as looser than the default.
export const loosens = (key: string, value: Value): boolean => guarded(key) && key in DEFAULT_KEYS && !tightens(key, DEFAULT_KEYS[key]!, value);

export function parseValue(raw: string): Value {
  if (raw === "true" || raw === "false") return raw === "true";
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw.startsWith("[")) return JSON.parse(raw) as Value;
  return raw;
}

export function resolve(cwd: string, overrides: Record<string, Value> = {}, paths = layerPaths(cwd)): Resolved {
  const flat: Record<string, Value> = { ...DEFAULT_KEYS };
  const sources: Record<string, Layer> = Object.fromEntries(Object.keys(flat).map((k) => [k, "default" as Layer]));
  const warnings: string[] = [];

  const layers: [Layer, Record<string, Value>][] = [
    ["global", flatten(readToml(paths.global) ?? {})],
    ["project", flatten(readToml(paths.project) ?? {})],
    ["local", flatten(readToml(paths.local) ?? {})],
    ["override", overrides],
  ];

  for (const [layer, values] of layers) {
    for (const [key, value] of Object.entries(values)) {
      const problem = validate(key, value);
      if (problem) {
        warnings.push(`${layer}: ${problem} (ignored)`);
        continue;
      }
      if (key === "safety.deny" && layer === "project" && Array.isArray(value)) {
        // The project may add to the deny-list, never remove from it.
        const current = (flat[key] as Value[]) ?? [];
        flat[key] = [...new Set([...current, ...value])];
        sources[key] = layer;
        continue;
      }
      if (layer === "project" && guarded(key) && !tightens(key, flat[key]!, value)) {
        warnings.push(`project: workflow.toml tries to weaken ${key} to ${JSON.stringify(value)}; set it in ~/.saw/config.toml or workflow.local.toml instead (ignored)`);
        continue;
      }
      flat[key] = value;
      sources[key] = layer;
    }
  }

  const config: Table = {};
  for (const [key, value] of Object.entries(flat)) setPath(config, key, value);
  return { config, sources, warnings };
}

// Safety values looser than the built-in defaults, for doctor and show.
export function weakenedSafety(resolved: Resolved): string[] {
  const flat = flatten(resolved.config);
  return Object.keys(DEFAULT_KEYS)
    .filter((k) => k.startsWith("safety.") && k !== "safety.deny")
    .filter((k) => !tightens(k, DEFAULT_KEYS[k]!, flat[k]!))
    .map((k) => `${k} = ${JSON.stringify(flat[k])} (from ${resolved.sources[k]})`);
}

// The branch PRs target: repo.protect.branch, or main.
export const baseBranch = (config: Table): string => ((config.repo ?? {}) as { protect?: { branch?: string } }).protect?.branch || "main";

// Resolves a configured path, or undefined if it escapes the project (a
// committed workflow.toml must not be able to write elsewhere).
export function inside(cwd: string, path: string): string | undefined {
  const full = resolvePath(cwd, path);
  const rel = relative(resolvePath(cwd), full);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? full : undefined;
}
