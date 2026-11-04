// `saw docs status | refresh`: which project docs are still the blank template,
// and whether the public surface changed without docs/reference changing.

import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { TEMPLATE_DIR, unedited } from "./init";

export interface DocState {
  path: string;
  state: "blank" | "filled" | "missing";
}

export interface DocsStatus {
  docs: DocState[];
  hasCode: boolean;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

// Workflow scaffolding, not project code.
const SCAFFOLD_DIRS = ["docs/", ".saw/", ".trail/", ".github/", ".githooks/", "graft/"];
const SCAFFOLD_FILES = ["AGENTS.md", "CLAUDE.md", "README.md", "LICENSE", ".gitignore", "workflow.toml", "workflow.local.toml"];
const isCode = (f: string): boolean => !SCAFFOLD_DIRS.some((d) => f.startsWith(d)) && !SCAFFOLD_FILES.includes(f);

export function trackedFiles(target: string): string[] {
  const out = Bun.spawnSync(["git", "ls-files"], { cwd: target, stderr: "pipe" });
  return out.success ? out.stdout.toString().split("\n").filter(Boolean) : [];
}

export function docsStatus(target: string, templates = TEMPLATE_DIR, files = trackedFiles(target)): DocsStatus {
  const docs = walk(join(templates, "docs"))
    .map((abs) => relative(templates, abs).replace(/\\/g, "/"))
    // Templates for new notes, not docs to fill in.
    .filter((rel) => !rel.endsWith("_template.md") && !rel.endsWith("0000-template.md"))
    .sort()
    .map((rel): DocState => ({
      path: rel,
      state: !existsSync(join(target, rel)) ? "missing" : unedited(target, rel, templates) ? "blank" : "filled",
    }));
  return { docs, hasCode: files.some(isCode) };
}

// Changes to commands, config or APIs that docs/reference should describe.
const SURFACE = /(^|\/)(cli|bin|commands|api|routes|schema|config)(\/|\.)|\.toml$|\.schema\.json$|openapi/i;

export function staleReference(changed: string[]): string[] {
  if (changed.some((f) => f.startsWith("docs/reference/"))) return [];
  return changed.filter((f) => !f.startsWith("docs/") && SURFACE.test(f));
}

export function changedFiles(target: string, base: string): string[] {
  const lines = (argv: string[]): string[] => {
    const out = Bun.spawnSync(["git", ...argv], { cwd: target, stderr: "pipe" });
    return out.success ? out.stdout.toString().split("\n").filter(Boolean) : [];
  };
  // base comes from committed settings: a value like --output=x must not reach git as an option.
  const ranged = /^[\w][\w./-]*$/.test(base) ? lines(["diff", "--name-only", `${base}...HEAD`]) : [];
  return [...new Set([...ranged, ...lines(["diff", "--name-only", "HEAD"])])];
}

// What `saw task end` prints when features.living_docs is on.
export function docsNudge(target: string, base: string): string[] {
  const status = docsStatus(target);
  const out: string[] = [];
  const blank = status.docs.filter((d) => d.state === "blank").map((d) => d.path);
  if (blank.length && status.hasCode) out.push(`docs: still blank: ${blank.join(", ")} (fill from the code: saw docs refresh)`);
  const stale = staleReference(changedFiles(target, base));
  if (stale.length) out.push(`docs: ${stale.slice(0, 3).join(", ")}${stale.length > 3 ? " …" : ""} changed but docs/reference/ didn't`);
  return out;
}

export const REFRESH_BRIEF = `Fill or update the project docs from the code. Read with trail (map, skeleton) before files.
For each doc saw docs status lists as blank, or that the recent changes affect:
- docs/reference/: commands, settings, APIs, data formats (dry, complete facts)
- docs/glossary.md: domain terms the code uses, one line each
- docs/conventions.md: patterns the code follows that a newcomer wouldn't guess
- docs/explanation/: how the main parts fit together and why
- docs/how-to/: tasks from the README and package scripts (build, test, release)
- docs/decisions/: one ADR per settled choice evident in the code, marked "status: inferred"
Use engineering:documentation. Write only what the code shows; leave a section out rather than guess.
Show the diff and wait for approval before writing.`;
