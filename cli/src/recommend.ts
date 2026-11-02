// MCP servers and skills from recommendations.toml: suggested once per session
// when a prompt needs one that isn't installed (features.recommend), and after
// a task when its changes fit a skill (features.skill_finder). `saw recommend
// add` runs the install command; nothing is installed without it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import type { Table } from "./defaults";
import { isSawProject } from "./task";
import { readToml } from "./toml";

export type Kind = "mcp" | "skills";

export interface Rec {
  id: string;
  kind: Kind;
  why: string;
  install: string[];
  installed: string[];
  keywords: string[];
  files: string[];
  exts: string[];
  marketplace?: string;
}

const PLUGIN_ROOT = join(import.meta.dir, "..", "..");
const STATE = join(".saw", "recommend.json");

export function catalog(path = join(PLUGIN_ROOT, "recommendations.toml")): Rec[] {
  const t = readToml(path) ?? {};
  return (["mcp", "skills"] as Kind[]).flatMap((kind) =>
    Object.entries((t[kind] ?? {}) as Record<string, Table>).map(([id, e]) => ({
      id,
      kind,
      why: String(e.why ?? ""),
      install: (e.install ?? []) as string[],
      installed: (e.installed ?? [id]) as string[],
      keywords: (e.keywords ?? []) as string[],
      files: (e.files ?? []) as string[],
      exts: (e.exts ?? []) as string[],
      marketplace: e.marketplace === undefined ? undefined : String(e.marketplace),
    })),
  );
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
  } catch {
    return undefined;
  }
}

const keys = (v: unknown): string[] => (v && typeof v === "object" ? Object.keys(v) : []);

// MCP server names from the project's .mcp.json and ~/.claude.json (user and
// per-project entries); plugin names from installed_plugins.json ("name@market").
export function installedNames(cwd: string, home = homedir()): { mcp: Set<string>; plugins: Set<string> } {
  const user = readJson(join(home, ".claude.json")) ?? {};
  const projects = (user.projects ?? {}) as Record<string, { mcpServers?: unknown }>;
  const here = resolve(cwd);
  const project = Object.entries(projects).find(([p]) => resolve(p).toLowerCase() === here.toLowerCase())?.[1];
  const mcp = new Set([
    ...keys(readJson(join(cwd, ".mcp.json"))?.mcpServers),
    ...keys(user.mcpServers),
    ...keys(project?.mcpServers),
  ].map((n) => n.toLowerCase()));
  const plugins = new Set(keys(readJson(join(home, ".claude", "plugins", "installed_plugins.json"))?.plugins).map((k) => k.split("@")[0]!.toLowerCase()));
  return { mcp, plugins };
}

export function isInstalled(rec: Rec, inst: { mcp: Set<string>; plugins: Set<string> }): boolean {
  const have = rec.kind === "mcp" ? inst.mcp : inst.plugins;
  // Connector-style names ("plugin:design:figma", "claude_ai_Figma") count too.
  return rec.installed.some((n) => [...have].some((h) => h === n || h.endsWith(`:${n}`) || h.endsWith(`_${n}`)));
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text: string, word: string): boolean => new RegExp(`(^|[^a-z0-9])${escape(word)}($|[^a-z0-9])`).test(text);

function settings(config: Table): { mode: string; mcp: boolean; skills: boolean } {
  return { mode: "auto", mcp: true, skills: true, ...((config.recommend ?? {}) as Table) } as { mode: string; mcp: boolean; skills: boolean };
}

function kinds(config: Table): Kind[] {
  const s = settings(config);
  return [...(s.mcp ? ["mcp" as const] : []), ...(s.skills ? ["skills" as const] : [])];
}

interface State {
  dismissed: string[];
  session?: string;
  seen: string[];
}

export function readState(cwd: string): State {
  const s = readJson(join(cwd, STATE)) as Partial<State> | undefined;
  return { dismissed: s?.dismissed ?? [], session: s?.session, seen: s?.seen ?? [] };
}

export function writeState(cwd: string, s: State): void {
  mkdirSync(join(cwd, ".saw"), { recursive: true });
  writeFileSync(join(cwd, STATE), `${JSON.stringify(s, null, 2)}\n`);
}

const ref = (r: Rec): string => `${r.kind}:${r.id}`;

// What the agent is told to do with a suggestion, per recommend.mode.
export function offer(config: Table, r: Rec, scope = ""): string {
  const what = `${r.kind === "mcp" ? "MCP server" : "skill plugin"} \`${r.id}\` (${r.why})`;
  if (settings(config).mode === "manual") return `${what}: tell the user they can install it with \`${installSteps(r, scope).map((a) => a.join(" ")).join(" && ")}\`.`;
  return `${what}: offer to set it up; if the user agrees, run \`saw recommend add ${r.id}${scope ? ` --scope ${scope}` : ""}\`.`;
}

// UserPromptSubmit: catalog entries the prompt mentions that aren't installed,
// dismissed or already suggested this session.
export function recommendHook(cwd: string, config: Table, input: { prompt?: unknown; session_id?: unknown }, inst = installedNames(cwd)): Record<string, unknown> | undefined {
  const features = (config.features ?? {}) as Record<string, boolean>;
  if (!features.recommend || !isSawProject(cwd) || typeof input.prompt !== "string") return undefined;
  const prompt = input.prompt.toLowerCase();
  const state = readState(cwd);
  const session = typeof input.session_id === "string" ? input.session_id : "";
  const seen = state.session === session ? state.seen : [];
  const want = new Set(kinds(config));
  const hits = catalog().filter((r) => want.has(r.kind) && !state.dismissed.includes(r.id) && !seen.includes(ref(r)) && !isInstalled(r, inst) && r.keywords.some((k) => mentions(prompt, k))).slice(0, 2);
  if (hits.length === 0) return undefined;
  writeState(cwd, { ...state, session, seen: [...seen, ...hits.map(ref)] });
  const lines = hits.map((r) => offer(config, r));
  return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: `[saw recommend] This task may need: ${lines.join(" ")} Mention it once; don't block the task on it.` } };
}

export function changedFiles(cwd: string): string[] {
  const out = (argv: string[]): string[] => Bun.spawnSync(argv, { cwd }).stdout.toString().split("\n").map((l) => l.trim()).filter(Boolean);
  return [...new Set([...out(["git", "diff", "--name-only", "HEAD"]), ...out(["git", "ls-files", "--others", "--exclude-standard"])])];
}

// saw task end / saw skills find: up to 3 skills that fit the finished task's
// playbook and changed files.
export function findSkills(cwd: string, config: Table, playbook: string, changed: string[], inst = installedNames(cwd)): Rec[] {
  if (!settings(config).skills) return [];
  const { dismissed } = readState(cwd);
  const text = `${playbook} ${changed.join(" ")}`.toLowerCase().replace(/[/_.-]/g, " ");
  const exts = new Set(changed.map((f) => extname(f).toLowerCase()));
  const score = (r: Rec): number =>
    r.exts.filter((e) => exts.has(e) || changed.some((f) => f.toLowerCase().endsWith(e))).length * 2 +
    r.files.filter((f) => existsSync(join(cwd, f))).length +
    r.keywords.filter((k) => mentions(text, k)).length;
  return catalog()
    .filter((r) => r.kind === "skills" && !dismissed.includes(r.id) && !isInstalled(r, inst))
    .map((r) => ({ r, s: score(r) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.r);
}

// The commands `saw recommend add` runs. --scope global|project|local maps to
// Claude Code's user|project|local.
export function installSteps(r: Rec, scope = ""): string[][] {
  const s = scope === "global" ? "user" : scope;
  const install = [...r.install];
  if (s) install.splice(3, 0, "--scope", s);
  return [...(r.marketplace ? [["claude", "plugin", "marketplace", "add", r.marketplace]] : []), install];
}

// PostToolUseFailure: a Figma MCP call hit a rate or plan limit.
export function figmaFallback(config: Table, input: { tool_name?: unknown; error?: unknown }): Record<string, unknown> | undefined {
  const features = (config.features ?? {}) as Record<string, boolean>;
  if (!features.recommend || !/figma/i.test(String(input.tool_name ?? ""))) return undefined;
  if (!/\b429\b|rate.?limit|too many requests|quota|limit (reached|exceeded)|upgrade your plan|plan limit/i.test(String(input.error ?? ""))) return undefined;
  const message = "[saw] Figma's MCP limit is reached. Carry on in the browser instead: open the Figma file (or the site to match) in the built-in browser, read layout, spacing, colours and type from the page and screenshots, and use the extract-design-system skill to pull tokens from a live site. Tell the user Figma calls are paused until the limit resets.";
  return { systemMessage: "saw: Figma MCP limit reached; continuing in the browser", hookSpecificOutput: { hookEventName: "PostToolUseFailure", additionalContext: message } };
}
