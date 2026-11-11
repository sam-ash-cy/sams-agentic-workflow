// Hooks run in the folder Claude Code was launched from; a session working in a git worktree
// reports its own folder as `cwd` in the payload. saw must read the task and settings of the
// folder the session works in, and never follow a payload to an unrelated repo.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookCwd } from "../src/hook-cwd";
import { run, useStdin } from "../src/main";

const tmp = (name: string): string => mkdtempSync(join(tmpdir(), `saw-hookcwd-${name}-`));

// A main checkout and a linked worktree, laid out the way git does it: .git is a directory
// in the main checkout and a file pointing into .git/worktrees/<name> in the worktree.
function repoWithWorktree(): { main: string; worktree: string } {
  const main = tmp("main");
  mkdirSync(join(main, ".git", "worktrees", "wt"), { recursive: true });
  const worktree = join(main, ".claude", "worktrees", "wt");
  mkdirSync(worktree, { recursive: true });
  writeFileSync(join(worktree, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt")}\n`);
  return { main, worktree };
}

const payload = (cwd: unknown): string => JSON.stringify({ cwd });

test("a payload cwd in a linked worktree of the same repo wins over the hook's own folder", () => {
  const { main, worktree } = repoWithWorktree();
  expect(hookCwd(payload(worktree), main)).toBe(worktree);
  // A subfolder of the worktree counts too.
  mkdirSync(join(worktree, "src"));
  expect(hookCwd(payload(join(worktree, "src")), main)).toBe(join(worktree, "src"));
});

test("a symlinked spelling of the same folders still matches (macOS temp folders, short Windows names)", () => {
  const { main } = repoWithWorktree();
  const alias = join(tmp("alias"), "main-link");
  symlinkSync(main, alias, "junction");
  const viaAlias = join(alias, ".claude", "worktrees", "wt");
  expect(hookCwd(payload(viaAlias), main)).toBe(viaAlias);
});

test("anything else keeps the folder the hook started in", () => {
  const { main, worktree } = repoWithWorktree();
  const other = tmp("other");
  mkdirSync(join(other, ".git"));
  const plain = tmp("plain");
  for (const text of [
    "",
    "not json",
    "{}",
    payload(undefined),
    payload(42),
    payload("relative/dir"),
    payload(join(main, "no-such-folder")),
    payload(other),
    payload(plain),
    payload(main),
  ]) {
    expect(hookCwd(text, main)).toBe(main);
  }
  // Not the other way round either: the worktree's own hook does not jump to the main checkout of another repo.
  expect(hookCwd(payload(other), worktree)).toBe(worktree);
});

test("a hook run with no folder given reads the settings and logs of the payload's folder", () => {
  const { main, worktree } = repoWithWorktree();
  writeFileSync(join(worktree, "workflow.toml"), "");
  const before = process.cwd();
  try {
    // The runner's cwd stands in for the folder Claude Code was launched from.
    process.chdir(main);
    useStdin(payload(worktree));
    run(["gate"]);
  } finally {
    useStdin("");
    process.chdir(before);
  }
  expect(existsSync(join(worktree, ".saw", "events.jsonl"))).toBe(true);
  expect(existsSync(join(main, ".saw"))).toBe(false);
});
