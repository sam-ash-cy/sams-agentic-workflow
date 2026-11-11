// Which folder a hook should work in. A hook process starts in the folder Claude Code was
// launched from, but a session that works in a git worktree reports its own folder as `cwd`
// in the hook payload. Reading the launch folder's task and settings there means the Stop gate
// blocks on a task that is not the session's, and the session's own task is never seen.

import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { sameFolder } from "./projects";

// Reads are tried directly rather than checked first, so nothing can change between a check
// and the read. A missing file is undefined; a directory is { dir: true }.
function readDotGit(path: string): string | { dir: true } | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EISDIR") return { dir: true };
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw e;
  }
}

// Symlinks resolved (macOS temp folders live behind one), so two spellings of a folder agree.
const real = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

// The shared .git directory of the repo `dir` belongs to: the same for a main checkout and
// all its linked worktrees. Plain file reads, no git process: the guard runs on every tool call.
export function gitCommonDir(dir: string): string | undefined {
  for (let here = resolve(dir); ; here = dirname(here)) {
    const dot = join(here, ".git");
    try {
      const found = readDotGit(dot);
      if (typeof found === "object") return real(dot);
      if (found !== undefined) {
        const gitdir = /^gitdir:\s*(.+)$/m.exec(found)?.[1]?.trim();
        if (!gitdir) return undefined;
        const own = resolve(here, gitdir);
        const common = readDotGit(join(own, "commondir"));
        if (typeof common === "string") return real(resolve(own, common.trim()));
        return real(basename(dirname(own)) === "worktrees" ? dirname(dirname(own)) : own);
      }
    } catch {
      return undefined;
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
  if (sameFolder(real(cwd), real(fallback))) return fallback;
  const theirs = gitCommonDir(cwd);
  const ours = gitCommonDir(fallback);
  return theirs && ours && sameFolder(theirs, ours) ? cwd : fallback;
}
