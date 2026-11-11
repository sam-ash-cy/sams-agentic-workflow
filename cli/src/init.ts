// `saw init`: copy templates/project into a repo. Never overwrites silently:
// existing files are skipped, or backed up to <file>.bak with --force.

import { appendFileSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { readIfExists } from "./fs";

// saw init --workspace: the git repos directly under dir that have no workflow.toml yet.
// Only a .git directory counts: a .git file is a worktree or submodule, which belongs to
// another repo and is never touched. Not recursive. Sorted, so the plan is stable.
export function workspaceRepos(dir: string): { todo: string[]; skipped: { path: string; why: string }[] } {
  const todo: string[] = [];
  const skipped: { path: string; why: string }[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    try {
      // lstat: a symlinked child points outside the workspace; leave it alone.
      if (!lstatSync(path).isDirectory()) continue;
      const git = join(path, ".git");
      if (!existsSync(git)) continue;
      if (!statSync(git).isDirectory()) skipped.push({ path, why: "worktree or submodule (.git is a file)" });
      else if (existsSync(join(path, "workflow.toml"))) skipped.push({ path, why: "already has workflow.toml" });
      else todo.push(path);
    } catch {
      // Unreadable entry (permissions, a race): leave it alone.
    }
  }
  return { todo, skipped };
}

export interface InitReport {
  installed: string[];
  skipped: string[];
  backedUp: string[];
  changed: string[];
}

export const TEMPLATE_DIR = join(import.meta.dir, "..", "..", "templates", "project");
const IGNORES = ["workflow.local.toml", ".saw/"];

function walk(dir: string): string[] {
  // Sorted: readdir order differs by filesystem (APFS isn't alphabetical).
  return readdirSync(dir).sort().flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

export function init(target: string, opts: { dryRun?: boolean; force?: boolean; templates?: string } = {}): InitReport {
  const templates = opts.templates ?? TEMPLATE_DIR;
  const report: InitReport = { installed: [], skipped: [], backedUp: [], changed: [] };

  for (const source of walk(templates)) {
    const rel = relative(templates, source).replaceAll("\\", "/");
    const dest = join(target, rel);
    if (existsSync(dest)) {
      if (readFileSync(dest, "utf8") === readFileSync(source, "utf8")) {
        report.skipped.push(rel);
        continue;
      }
      if (!opts.force) {
        report.skipped.push(`${rel} (exists; --force backs it up and replaces it)`);
        continue;
      }
      report.backedUp.push(`${rel} -> ${rel}.bak`);
      if (!opts.dryRun) copyFileSync(dest, `${dest}.bak`);
    }
    report.installed.push(rel);
    if (!opts.dryRun) {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(source, dest);
      recordInstalled(target, rel, readFileSync(source, "utf8"));
    }
  }

  const gitignore = join(target, ".gitignore");
  const current = readIfExists(gitignore) ?? "";
  const lines = current.split(/\r?\n/);
  const missing = IGNORES.filter((entry) => !lines.includes(entry));
  if (missing.length) {
    report.changed.push(`.gitignore (+ ${missing.join(", ")})`);
    if (!opts.dryRun) {
      const sep = current && !current.endsWith("\n") ? "\n" : "";
      writeFileSync(gitignore, current + sep + missing.join("\n") + "\n");
    }
  }
  return report;
}

// What init installed, as content hashes, so uninstall and upgrade can tell a
// file the user edited from one still as installed.
const MANIFEST = join(".saw", "installed.json");
const hash = (text: string): string => new Bun.CryptoHasher("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");

function readManifest(target: string): Record<string, string> {
  const path = join(target, MANIFEST);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, string>) : {};
}

export function recordInstalled(target: string, rel: string, text: string): void {
  const m = readManifest(target);
  m[rel] = hash(text);
  mkdirSync(join(target, ".saw"), { recursive: true });
  writeFileSync(join(target, MANIFEST), JSON.stringify(m, null, 2) + "\n");
}

// Unedited: matches what init installed, or the current template.
export function unedited(target: string, rel: string, templates: string): boolean {
  const dest = join(target, rel);
  if (!existsSync(dest)) return false;
  const h = hash(readFileSync(dest, "utf8"));
  const source = join(templates, rel);
  return h === readManifest(target)[rel] || (existsSync(source) && h === hash(readFileSync(source, "utf8")));
}

export interface ChangeReport {
  done: string[];
  kept: string[];
}

// `saw uninstall`: removes template files the user hasn't edited; edited ones stay.
export function uninstall(target: string, opts: { dryRun?: boolean; templates?: string } = {}): ChangeReport {
  const templates = opts.templates ?? TEMPLATE_DIR;
  const rels = new Set([...Object.keys(readManifest(target)), ...walk(templates).map((s) => relative(templates, s).replaceAll("\\", "/"))]);
  const report: ChangeReport = { done: [], kept: [] };
  for (const rel of [...rels].sort()) {
    // The manifest is a local file; never let an entry reach outside the project.
    if (rel.split("/").includes("..") || isAbsolute(rel) || !existsSync(join(target, rel))) continue;
    if (!unedited(target, rel, templates)) {
      report.kept.push(rel);
      continue;
    }
    report.done.push(rel);
    if (!opts.dryRun) rmSync(join(target, rel));
  }
  if (!opts.dryRun) rmSync(join(target, MANIFEST), { force: true });
  return report;
}

// `saw init --upgrade`: brings unedited files up to the current template and
// adds new ones; edited files are listed and left alone.
export function upgrade(target: string, opts: { dryRun?: boolean; templates?: string } = {}): ChangeReport {
  const templates = opts.templates ?? TEMPLATE_DIR;
  const report: ChangeReport = { done: [], kept: [] };
  for (const source of walk(templates)) {
    const rel = relative(templates, source).replaceAll("\\", "/");
    const dest = join(target, rel);
    const text = readFileSync(source, "utf8");
    const existing = readIfExists(dest);
    if (existing !== undefined && hash(existing) === hash(text)) continue;
    // The settings file is the project's own once created; upgrade never replaces it.
    if (rel === "workflow.toml" && existing !== undefined) continue;
    if (existing !== undefined && !unedited(target, rel, templates)) {
      report.kept.push(rel);
      continue;
    }
    report.done.push(rel);
    if (!opts.dryRun) {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, text);
      recordInstalled(target, rel, text);
    }
  }
  return report;
}

// Default checks.dep_audit from the lockfiles present; undefined when none match.
const AUDITS: [string, string][] = [
  ["bun.lock", "bun audit"],
  ["bun.lockb", "bun audit"],
  ["package-lock.json", "npm audit --audit-level=high"],
  ["pnpm-lock.yaml", "pnpm audit --audit-level high"],
  ["yarn.lock", "yarn npm audit"],
  ["composer.lock", "composer audit"],
  ["requirements.txt", "pip-audit -r requirements.txt"],
  ["poetry.lock", "pip-audit"],
  ["Cargo.lock", "cargo audit"],
  ["go.sum", "govulncheck ./..."],
];

export function depAuditFor(target: string): string | undefined {
  const found = [...new Set(AUDITS.filter(([f]) => existsSync(join(target, f))).map(([, cmd]) => cmd))];
  return found.length ? found.join(" && ") : undefined;
}

// project.type from the manifests in the repo (the root and two levels down),
// so the template's "web" isn't kept for an API or infra repo. A server
// framework wins over a frontend one: a backend + frontend repo is an api.
const TYPE_HINTS: [RegExp, string][] = [
  [/\b(fastapi|flask|django|starlette|express|fastify|hono|koa|@nestjs\/core|laravel\/framework|gin-gonic|actix-web|axum)\b/, "api"],
  [/\b(next|react|vue|svelte|vite|nuxt|astro|@angular\/core)\b/, "web"],
];
const MANIFESTS = ["package.json", "pyproject.toml", "requirements.txt", "composer.json", "go.mod", "Cargo.toml"];
const SKIP_DIRS = new Set(["node_modules", ".git", "vendor", "dist", "build", ".venv", "target"]);

export function guessType(target: string): { type: string; from: string } | undefined {
  const manifests: string[] = [];
  let tf = "";
  const walk = (dir: string, depth: number): void => {
    let entries;
    try {
      entries = readdirSync(join(target, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (depth < 2 && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(rel, depth + 1);
      } else if (MANIFESTS.includes(e.name)) manifests.push(rel);
      else if (!tf && e.name.endsWith(".tf")) tf = rel;
    }
  };
  walk("", 0);
  for (const [re, type] of TYPE_HINTS) {
    const hit = manifests.find((m) => re.test(readFileSync(join(target, m), "utf8")));
    if (hit) return { type, from: hit };
  }
  const root = manifests.find((m) => m === "package.json");
  if (root && /"bin"\s*:/.test(readFileSync(join(target, root), "utf8"))) return { type: "cli", from: root };
  if (tf && manifests.length === 0) return { type: "infra", from: tf };
  return undefined;
}

export interface ProjectSetup {
  report: InitReport;
  // checks.dep_audit added from the lockfiles found.
  audit?: string;
  // project.type guessed from the files found (none when --type was given).
  guessed?: { type: string; from: string };
  // --type was given but workflow.toml already existed, so it was not applied.
  typeIgnored: boolean;
}

// Everything `saw init` does to a folder, without printing: the templates, then, for a new
// workflow.toml, the dep_audit check and the project type. `saw init`, `saw projects add
// --setup` and the dashboard's Set up button all come through here.
export function initProject(target: string, opts: { dryRun?: boolean; force?: boolean; type?: string } = {}): ProjectSetup {
  const report = init(target, { dryRun: opts.dryRun, force: opts.force });
  const fresh = report.installed.includes("workflow.toml");
  const path = join(target, "workflow.toml");
  const audit = fresh ? depAuditFor(target) : undefined;
  if (audit) {
    report.changed.push(`workflow.toml (checks.dep_audit = "${audit}")`);
    if (!opts.dryRun) {
      appendFileSync(path, `\n[checks]\ndep_audit = ${JSON.stringify(audit)}   # from the lockfiles found by saw init\n`);
      recordInstalled(target, "workflow.toml", readFileSync(path, "utf8"));
    }
  }
  const guessed = opts.type === undefined && fresh ? guessType(target) : undefined;
  const chosen = opts.type ?? guessed?.type;
  const typeIgnored = opts.type !== undefined && !fresh;
  if (!typeIgnored && chosen && !opts.dryRun) {
    writeFileSync(path, readFileSync(path, "utf8").replace(/^type = "\w+"/m, `type = "${chosen}"`));
    recordInstalled(target, "workflow.toml", readFileSync(path, "utf8"));
  }
  return { report, audit, guessed, typeIgnored };
}
