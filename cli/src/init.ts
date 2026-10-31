// `saw init`: copy templates/project into a repo. Never overwrites silently:
// existing files are skipped, or backed up to <file>.bak with --force.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export interface InitReport {
  installed: string[];
  skipped: string[];
  backedUp: string[];
  changed: string[];
}

export const TEMPLATE_DIR = join(import.meta.dir, "..", "..", "templates", "project");
const IGNORES = ["workflow.local.toml", ".saw/"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
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
    }
  }

  const gitignore = join(target, ".gitignore");
  const current = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "";
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
