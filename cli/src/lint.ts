// `saw lint-context`: keep always-loaded context files short (ADR 0011/0012:
// long or generated context files cost tokens and can lower success rates).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Table } from "./defaults";

export function lintContext(cwd: string, config: Table): string[] {
  const limits = (config.context ?? {}) as { agents_md_max_lines?: number; claude_md_max_lines?: number };
  const files: [string, number][] = [
    ["AGENTS.md", limits.agents_md_max_lines ?? 100],
    ["CLAUDE.md", limits.claude_md_max_lines ?? 200],
  ];
  const problems: string[] = [];
  for (const [file, max] of files) {
    const path = join(cwd, file);
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, "utf8").trimEnd().split(/\r?\n/).length;
    if (lines > max) problems.push(`${file} has ${lines} lines (max ${max}): move detail into docs/ or a skill`);
  }
  return problems;
}

// A backticked repo path such as `cli/src/task.ts` or `cli/src/task.ts:42`.
const PATH_REF = /`([\w.-]+(?:\/[\w.-]+)+\.[a-z]{1,5})(?::\d+(?:-\d+)?)?`/g;
const MEMORY_DIRS = ["docs/learnings", "docs/decisions"];

// `saw memory lint`: stale file references and duplicate learnings, plus the
// context size limits. It only reports; pruning goes through a proposal.
export function lintMemory(cwd: string, config: Table): string[] {
  const problems = lintContext(cwd, config);
  const titles = new Map<string, string>();
  for (const d of MEMORY_DIRS) {
    const dir = join(cwd, d);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".md") && n !== "README.md")) {
      const rel = `${d}/${f}`;
      const text = readFileSync(join(dir, f), "utf8");
      for (const [, ref] of text.matchAll(PATH_REF)) {
        if (!existsSync(join(cwd, ref!))) problems.push(`${rel}: \`${ref}\` no longer exists`);
      }
      if (d !== "docs/learnings") continue;
      const title = (/^#\s+(.+)$/m.exec(text)?.[1] ?? f).trim().toLowerCase();
      const first = titles.get(title);
      if (first) problems.push(`${rel}: same title as ${first}; merge them`);
      else titles.set(title, rel);
    }
  }
  return problems;
}
