// Which folder a hook should work in. A hook process starts in the folder Claude Code was
// launched from, but a session that works in a git worktree reports its own folder as `cwd`
// in the hook payload. Reading the launch folder's task and settings there means the Stop gate
// blocks on a task that is not the session's, and the session's own task is never seen.

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { sameFolder } from "./projects";

// The shared .git directory of the repo `dir` belongs to: the same for a main checkout and
// all its linked worktrees. Plain file reads, no git process: the guard runs on every tool call.
export function gitCommonDir(dir: string): string | undefined {
  for (let here = resolve(dir); ; here = dirname(here)) {
    const dot = join(here, ".git");
    if (existsSync(dot)) {
      try {
        if (statSync(dot).isDirectory()) return dot;
        const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dot, "utf8"))?.[1]?.trim();
        if (!gitdir) return undefined;
        const own = resolve(here, gitdir);
        const common = join(own, "commondir");
        if (existsSync(common)) return resolve(own, readFileSync(common, "utf8").trim());
        return basename(dirname(own)) === "worktrees" ? dirname(dirname(own)) : own;
      } catch {
        return undefined;
      }
    }
    if (dirname(here) === here) return undefined;
  }
}

// The payload's cwd when it is an existing folder of the same repo as `fallback` (the hook's
// own folder), otherwise `fallback`. The same-repo rule keeps a payload from pointing saw's
// settings and guard decisions at an unrelated folder.
export function hookCwd(payload: string, fallback: string): string {
  let cwd: unknown;
  try {
    cwd = (JSON.parse(payload) as { cwd?: unknown }).cwd;
  } catch {
    return fallback;
  }
  if (typeof cwd !== "string" || !isAbsolute(cwd)) return fallback;
  try {
    if (!statSync(cwd).isDirectory()) return fallback;
  } catch {
    return fallback;
  }
  if (sameFolder(cwd, fallback)) return fallback;
  const theirs = gitCommonDir(cwd);
  const ours = gitCommonDir(fallback);
  return theirs && ours && sameFolder(theirs, ours) ? cwd : fallback;
}
