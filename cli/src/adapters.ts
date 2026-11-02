// Agent adapters: make each coding agent read the project's AGENTS.md.
// Tier 1 (Claude Code, Codex) and Tier 2 (Cursor, Gemini CLI). Codex and
// Cursor read AGENTS.md natively; Claude Code reads it through CLAUDE.md's
// `@AGENTS.md` import; Gemini CLI needs contextFileName in .gemini/settings.json.
// The gates themselves (git hooks, CI) work the same in every agent.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const AGENTS = ["claude", "codex", "cursor", "gemini"] as const;

const CURSOR_RULE = `---
description: sams-agentic-workflow
alwaysApply: true
---
Follow AGENTS.md. Before saying a task is done, run each required check with \`saw run <check>\` and report the label from \`saw task status\` (Verified, Partially verified, Not verified or Blocked).
`;

// Files an adapter adds; existing files are never overwritten.
const FILES: Record<string, Record<string, string>> = {
  claude: {},
  codex: {},
  cursor: { ".cursor/rules/saw.mdc": CURSOR_RULE },
  gemini: { ".gemini/settings.json": JSON.stringify({ contextFileName: ["AGENTS.md"] }, null, 2) + "\n" },
};

export function installAdapters(cwd: string, agents: string[], dryRun = false): { installed: string[]; skipped: string[] } {
  const out = { installed: [] as string[], skipped: [] as string[] };
  for (const agent of agents) {
    for (const [rel, text] of Object.entries(FILES[agent] ?? {})) {
      const path = join(cwd, rel);
      const skip = `${rel} (exists; check it lists AGENTS.md)`;
      if (dryRun) {
        if (existsSync(path)) out.skipped.push(skip);
        else out.installed.push(rel);
        continue;
      }
      mkdirSync(dirname(path), { recursive: true });
      try {
        // wx: create only, so an existing file is never overwritten.
        writeFileSync(path, text, { flag: "wx" });
        out.installed.push(rel);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        out.skipped.push(skip);
      }
    }
  }
  return out;
}

// Smoke test: will each agent load AGENTS.md here? Returns one problem per agent that won't.
export function checkAdapters(cwd: string, agents: string[]): string[] {
  const read = (rel: string): string | undefined => (existsSync(join(cwd, rel)) ? readFileSync(join(cwd, rel), "utf8") : undefined);
  if (read("AGENTS.md") === undefined) return ["AGENTS.md is missing (saw init adds it)"];
  const problems: string[] = [];
  for (const agent of agents) {
    if (!(AGENTS as readonly string[]).includes(agent)) problems.push(`${agent}: unknown agent (one of ${AGENTS.join(", ")})`);
    else if (agent === "claude" && !/^@AGENTS\.md/m.test(read("CLAUDE.md") ?? "")) problems.push("claude: CLAUDE.md doesn't import @AGENTS.md");
    else if (agent === "gemini") {
      let names: unknown;
      try {
        names = (JSON.parse(read(".gemini/settings.json") ?? "{}") as { contextFileName?: unknown }).contextFileName;
      } catch {
        problems.push("gemini: .gemini/settings.json is not valid JSON");
        continue;
      }
      const list = Array.isArray(names) ? names : [names];
      if (!list.includes("AGENTS.md") && !/^@AGENTS\.md/m.test(read("GEMINI.md") ?? "")) {
        problems.push("gemini: add \"AGENTS.md\" to contextFileName in .gemini/settings.json (saw init --agents gemini)");
      }
    }
  }
  return problems;
}
