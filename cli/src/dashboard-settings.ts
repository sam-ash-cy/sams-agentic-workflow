// The live dashboard's data and write API (saw dashboard --serve). serveDashboard in main.ts
// owns the socket, the host check and the headers; everything under /api/ is handled here.
// A project is always named by its position in ~/.saw/projects.json, never by a path from
// the request, and every write goes through writeSetting, the same code as saw config set.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { adoption } from "./adoption";
import { readRuns } from "./autopilot";
import { statsHtml } from "./dashboard";
import { DEFAULTS, DESCRIPTIONS, ENUMS, type Table, type Value } from "./defaults";
import { flatten, guarded, inside, layerPaths, layerValues, loosens, resolve, writeSetting, type LayerPaths } from "./config";
import { logEvent, readEvents } from "./events";
import { initProject } from "./init";
import { readMetrics } from "./metrics";
import { modStates, setModEnabled } from "./mods";
import { addProject, inspectProject, listProjects, registerProject, removeProject, sameFolder, type Project } from "./projects";
import { readProposals } from "./retro";

export interface DashboardCtx {
  cwd: string;
  config: Table;
  home: string;
  claudeDir: string;
  pluginRoot: string;
  readOnly: boolean;
}

export type Scope = "global" | "project" | "local";

export interface SettingRow {
  key: string;
  group: string;
  description: string;
  type: "boolean" | "enum" | "number" | "text" | "list";
  options?: string[];
  min?: number;
  max?: number;
  default: Value;
  value: Value;
  source: string;
  // The value in the layer being edited, when that layer sets one.
  layer?: Value;
  // Values the shared project file may not take: it can only tighten this key.
  blocked?: Value[];
  note?: string;
}

export const claudeConfigDir = (): string => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");

const ACTION_VALUES = ["never", "ask", "propose", "allow"];
const FLAT_DEFAULTS = flatten(DEFAULTS);

const json = (status: number, body: unknown): Response => Response.json(body, { status });
const refuse = (status: number, problem: string): Response => json(status, { ok: false, problem });

type Target = { id: "global"; path: string } | { id: string; path: string; project: Project };

// "global", or the position of a project in the registry. Anything else is not a project.
export function findTarget(ctx: DashboardCtx, id: unknown): Target | undefined {
  if (id === "global") return { id, path: ctx.cwd };
  if (typeof id !== "string" || !/^\d{1,6}$/.test(id)) return undefined;
  const project = listProjects(ctx.home)[Number(id)];
  return project ? { id, path: project.path, project } : undefined;
}

// The project a write names. The page sends the folder's path along with its position in the
// list; if they disagree the list changed under the page (a project was removed elsewhere),
// and writing would hit the wrong project. A write also never recreates a folder that is gone
// or edits settings that do not parse (needsFolder).
function writeTarget(ctx: DashboardCtx, body: Record<string, unknown>, needsFolder: boolean): Target | Response {
  const t = findTarget(ctx, body.project);
  if (!t) return refuse(404, "no such project");
  if (t.id === "global") return t;
  if (typeof body.path !== "string" || !sameFolder(body.path, t.path)) return refuse(409, "the project list changed: reload the page");
  if (needsFolder) {
    const state = inspectProject(t.path).state;
    if (state === "missing") return refuse(400, "this folder is not there any more");
    if (state === "broken settings") return refuse(400, "this project's settings do not parse: fix the file first");
  }
  return t;
}

// Events go to the project's own log. A global change made from a folder that is not a saw
// project is not logged, rather than creating .saw/ in a folder that has nothing to do with it.
export function logHere(ctx: DashboardCtx, level: "info" | "warn", kind: string, message: string, data?: Record<string, unknown>, project?: string, config?: Table): void {
  const at = project ?? ctx.cwd;
  if (!existsSync(layerPaths(at, ctx.home).project)) return;
  logEvent(at, config ?? ctx.config, level, kind, message, data);
}

// Where each layer lives for a target. Global has one layer; its project layers are absent.
function layersFor(ctx: DashboardCtx, t: Target): LayerPaths {
  if (t.id === "global") {
    const none = join(ctx.home, "no-layer.toml");
    return { global: layerPaths(ctx.cwd, ctx.home).global, project: none, local: none };
  }
  return layerPaths(t.path, ctx.home);
}

function typeOf(key: string, def: Value | undefined): { type: SettingRow["type"]; options?: string[] } {
  const options = ENUMS[key] ?? (key.startsWith("autonomy.actions.") ? ACTION_VALUES : undefined);
  if (options) return { type: "enum", options };
  if (Array.isArray(def)) return { type: "list" };
  if (typeof def === "boolean") return { type: "boolean" };
  if (typeof def === "number") return { type: "number" };
  return { type: "text" };
}

export function settingsRows(ctx: DashboardCtx, t: Target, scope: Scope): { rows: SettingRow[]; warnings: string[] } {
  const paths = layersFor(ctx, t);
  const resolved = resolve(t.path, {}, paths);
  const rows = layerValues(t.path, resolved, paths).map((r): SettingRow => {
    const def = FLAT_DEFAULTS[r.key];
    const { type, options } = typeOf(r.key, def);
    const layer = r[scope];
    const row: SettingRow = {
      key: r.key,
      group: r.key.includes(".") ? r.key.split(".")[0]! : "general",
      description: DESCRIPTIONS[r.key] ?? "",
      type,
      default: def ?? r.value,
      value: r.value,
      source: r.source,
    };
    if (options) row.options = options;
    if (type === "number") [row.min, row.max] = rangeOf(r.key);
    if (layer !== undefined) row.layer = layer;
    if (scope === "project" && guarded(r.key)) {
      const candidates: Value[] = options ?? (type === "boolean" ? [true, false] : []);
      const blocked = candidates.filter((c) => loosens(r.key, c));
      if (blocked.length) row.blocked = blocked;
      // A project value that did not win was dropped as weaker than the value under it.
      if (layer !== undefined && (r.source === "default" || r.source === "global")) row.note = "Ignored: a committed workflow.toml can only tighten this.";
    }
    return row;
  });
  return { rows, warnings: resolved.warnings };
}

export function projectSummary(path: string, state: string): string {
  if (state === "missing") return "folder not found";
  if (state === "not set up") return "not set up";
  const metrics = readMetrics(path);
  if (!metrics.length) return "no tasks yet";
  const verified = metrics.filter((m) => m.label === "Verified").length;
  return `${metrics.length} tasks, ${Math.round((verified / metrics.length) * 100)}% verified`;
}

export function projectList(ctx: DashboardCtx): { writable: boolean; current: string; projects: { id: string; name: string; path: string; state: string; summary: string }[] } {

  const list = listProjects(ctx.home);
  const at = list.findIndex((p) => sameFolder(p.path, ctx.cwd));
  return {
    writable: !ctx.readOnly,
    current: at >= 0 ? String(at) : "global",
    projects: [
      { id: "global", name: "Global", path: layerPaths(ctx.cwd, ctx.home).global, state: "ready", summary: "applies to every project" },
      ...list.map((p, i) => {
        const state = inspectProject(p.path).state;
        return { id: String(i), name: p.name, path: p.path, state, summary: projectSummary(p.path, state) };
      }),
    ],
  };
}

// The Statistics tab for one project: the same KPIs and panels as the static page.
export function statsFor(ctx: DashboardCtx, t: Target): string {
  if (t.id === "global") return `<p class="empty">Statistics are kept per project. Pick a project on the left.</p>`;
  if (inspectProject(t.path).state === "missing") return `<p class="empty">This folder is not there any more.</p>`;
  const config = resolve(t.path).config;
  const d = config.dashboard as { panels: string[]; events_limit: number };
  const proposalsDir = inside(t.path, (config.retro as { proposals_dir: string }).proposals_dir);
  const metrics = readMetrics(t.path);
  return statsHtml(metrics, d.panels, proposalsDir ? readProposals(proposalsDir) : [], readRuns(t.path), readEvents(t.path, d.events_limit), adoption(readEvents(t.path), metrics));
}

const SCOPES: Scope[] = ["global", "project", "local"];
const scalar = (v: unknown): v is string | number | boolean => ["string", "number", "boolean"].includes(typeof v);

// Beyond writeSetting's own checks (known key, enum, same type as the default): numbers must
// be finite, lists flat, and a key with a fixed set of values takes only those.
// Numbers: none of the number settings makes sense below 0. These are the ones with a
// tighter range; the page sets min and max on the field from the same table.
const RANGES: Record<string, [number, number]> = {
  "tokens.warn_at": [0, 1],
  "context.handoff_at": [0, 1],
  "context.window_tokens": [1000, 10_000_000],
  "context.autocompact_window": [0, 1_000_000],
  "dashboard.port": [1, 65535],
  "dashboard.events_limit": [1, 10_000],
  "evals.runs": [1, 100],
  "repo.protect.required_approvals": [0, 10],
};
export const rangeOf = (key: string): [number, number] => RANGES[key] ?? [0, Number.MAX_SAFE_INTEGER];

function checkValue(key: string, value: Value): string | undefined {
  const def = FLAT_DEFAULTS[key];
  const options = typeOf(key, def).options;
  if (typeof value === "number") {
    const [min, max] = rangeOf(key);
    if (value < min || value > max) return `${key} must be between ${min} and ${max === Number.MAX_SAFE_INTEGER ? "a large number" : max}`;
  }
  // 0 means "leave Claude Code's auto-compact alone"; otherwise Claude Code accepts 100000 to 1000000.
  if (key === "context.autocompact_window" && value !== 0 && typeof value === "number" && value < 100000) return `${key} must be 0 or from 100000 to 1000000`;
  if (key === "context.suggest_compact_at" && Array.isArray(value) && !value.every((v) => typeof v === "number" && v > 0 && v <= 1)) return `${key} must be shares of the window between 0 and 1`;
  if (options && !options.includes(String(value))) return `${key} must be one of ${options.join(" | ")}`;
  if (typeof value === "number" && !Number.isFinite(value)) return `${key} must be a number`;
  if (Array.isArray(value)) {
    if (!value.every(scalar)) return `${key} must be a list of plain values`;
    const first = Array.isArray(def) ? def[0] : undefined;
    if (first !== undefined && !value.every((v) => typeof v === typeof first)) return `${key} must be a list of ${typeof first}s`;
    if (first === undefined && !value.every((v) => typeof v === "string")) return `${key} must be a list of text`;
  }
  if (typeof value === "object" && !Array.isArray(value)) return `${key} must be a single value or a list`;
  return undefined;
}

function change(ctx: DashboardCtx, body: Record<string, unknown>): Response {
  const t = writeTarget(ctx, body, true);
  if (t instanceof Response) return t;
  const scope = SCOPES.find((s) => s === body.scope);
  if (!scope || (t.id === "global") !== (scope === "global")) return refuse(400, t.id === "global" ? "global settings are written to the global layer" : "a project takes the project or local layer");
  const key = body.key;
  if (typeof key !== "string") return refuse(400, "key is required");
  const unset = body.unset === true;
  if (!unset && body.value === undefined) return refuse(400, "value is required");
  const value = unset ? undefined : (body.value as Value);
  if (t.id !== "global" && inspectProject(t.path).state === "not set up") return refuse(400, "set this project up first");
  if (value !== undefined) {
    const problem = checkValue(key, value);
    if (problem) return refuse(400, problem);
    if (scope === "project" && loosens(key, value)) return refuse(400, `The shared workflow.toml can only tighten ${key}. Set it under "Only me" instead.`);
  }
  const paths = layersFor(ctx, t);
  const before = layerValues(t.path, resolve(t.path, {}, paths), paths).find((r) => r.key === key)?.[scope];
  let result;
  try {
    result = writeSetting(paths[scope], scope, key, value);
  } catch (e) {
    return refuse(400, `could not write ${paths[scope]}: ${(e as Error).message}`);
  }
  if (!result.ok) return refuse(400, result.problem ?? "could not save");
  const config = t.id === "global" ? ctx.config : resolve(t.path, {}, paths).config;
  const shown = (v: Value | undefined): string => (v === undefined ? "(not set)" : JSON.stringify(v));
  logHere(ctx, "info", "settings.changed", `${key} in ${scope}: ${shown(before)} -> ${unset ? "(removed)" : shown(value)}`, { key, scope, from: before, to: value, via: "dashboard" }, t.id === "global" ? undefined : t.path, config);
  const row = settingsRows(ctx, t, scope).rows.find((r) => r.key === key);
  return json(200, { ok: true, ...(result.warning ? { warning: result.warning } : {}), row });
}

function projects(ctx: DashboardCtx, body: Record<string, unknown>): Response {
  if (body.action === "add") {
    const path = body.path;
    if (typeof path !== "string" || !path.trim() || path.length > 4096) return refuse(400, "give the folder's full path");
    if (!isAbsolute(path.trim())) return refuse(400, "give the full path, starting from the drive or /");
    const r = addProject(path.trim(), ctx.home);
    if (!r.ok) return refuse(400, r.problem ?? "could not add the project");
    const id = String(listProjects(ctx.home).findIndex((p) => p.path === r.project!.path));
    return json(200, { ok: true, id, state: r.inspection!.state, problems: r.inspection!.problems, warnings: r.inspection!.warnings });
  }
  if (body.action !== "remove" && body.action !== "setup") return refuse(400, "unknown action");
  const t = writeTarget(ctx, body, false);
  if (t instanceof Response) return t;
  if (t.id === "global") return refuse(404, "no such project");
  if (body.action === "remove") {
    removeProject(t.path, ctx.home);
    return json(200, { ok: true });
  }
  if (body.action === "setup") {
    if (inspectProject(t.path).state !== "not set up") return refuse(400, "this project is already set up");
    try {
      initProject(t.path, { dryRun: false, force: false });
    } catch (e) {
      return refuse(500, `setup failed: ${(e as Error).message}`);
    }
    registerProject(t.path, ctx.home);
    return json(200, { ok: true, state: inspectProject(t.path).state });
  }
  return refuse(400, "unknown action");
}

function modFiles(ctx: DashboardCtx, t: Target): { user: string; local?: string } {
  return { user: join(ctx.claudeDir, "settings.json"), local: t.id === "global" ? undefined : join(t.path, ".claude", "settings.local.json") };
}

function mods(ctx: DashboardCtx, t: Target): Response {
  const f = modFiles(ctx, t);
  try {
    return json(200, { writable: !ctx.readOnly, restart: "A change takes effect in a new Claude session.", scope: t.id === "global" ? "your user settings" : ".claude/settings.local.json", mods: modStates(ctx.pluginRoot, f.user, f.local) });
  } catch (e) {
    return refuse(500, `could not read the Claude settings: ${(e as Error).message}`);
  }
}

function switchMod(ctx: DashboardCtx, body: Record<string, unknown>): Response {
  const t = writeTarget(ctx, body, false);
  if (t instanceof Response) return t;
  if (t.id !== "global" && inspectProject(t.path).state === "missing") return refuse(400, "this folder is not there any more");
  if (typeof body.name !== "string" || typeof body.enabled !== "boolean") return refuse(400, "name and enabled are required");
  const f = modFiles(ctx, t);
  const r = setModEnabled(ctx.pluginRoot, f.user, f.local ?? f.user, body.name, body.enabled);
  if (!r.ok) return refuse(400, r.problem ?? "could not change the mod");
  logHere(ctx, "info", "mods.changed", `${body.name} ${body.enabled ? "enabled" : "disabled"} for ${t.id === "global" ? "all projects" : t.path}`, { name: body.name, enabled: body.enabled, via: "dashboard" }, t.id === "global" ? undefined : t.path);
  return mods(ctx, t);
}

// GET /api/*. Reads are open to anything that passed the host check; the host check is
// what stops a page on another site from reading them through DNS rebinding.
export function apiGet(ctx: DashboardCtx, url: URL): Response {
  const path = url.pathname;
  if (path === "/api/projects") return json(200, projectList(ctx));
  const t = findTarget(ctx, url.searchParams.get("project") ?? "global");
  if (!t) return refuse(404, "no such project");
  if (path === "/api/settings") {
    const scope = (url.searchParams.get("scope") ?? (t.id === "global" ? "global" : "project")) as Scope;
    if ((t.id === "global") !== (scope === "global") || !SCOPES.includes(scope)) return refuse(400, "bad scope");
    return json(200, settingsRows(ctx, t, scope));
  }
  if (path === "/api/mods") return mods(ctx, t);
  if (path === "/api/stats") return new Response(statsFor(ctx, t), { headers: { "content-type": "text/html; charset=utf-8" } });
  return refuse(404, "not found");
}

const MAX_BODY = 64 * 1024;

// POST /api/*. The caller has already checked host, origin and token.
export async function apiPost(ctx: DashboardCtx, req: Request): Promise<Response> {
  const path = new URL(req.url).pathname;
  if (!["/api/settings", "/api/projects", "/api/mods"].includes(path)) return refuse(404, "not found");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return refuse(413, "request too large");
  const text = await req.text();
  if (text.length > MAX_BODY) return refuse(413, "request too large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse(400, "the request is not JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return refuse(400, "the request must be a JSON object");
  const b = body as Record<string, unknown>;
  if (path === "/api/settings") return change(ctx, b);
  if (path === "/api/projects") return projects(ctx, b);
  return switchMod(ctx, b);
}
