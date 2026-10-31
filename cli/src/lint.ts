// `saw lint-context`: keep always-loaded context files short (ADR 0011/0012:
// long or generated context files cost tokens and can lower success rates).

import { existsSync, readFileSync } from "node:fs";
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
