import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceRepos } from "../src/init";
import { run } from "../src/main";

// fresh: a repo to set up; done: already has workflow.toml; wt: a worktree (.git file);
// plain: not a repo; a stray file. Only fresh is initialised.
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "saw-workspace-"));
  mkdirSync(join(dir, "fresh", ".git"), { recursive: true });
  mkdirSync(join(dir, "done", ".git"), { recursive: true });
  writeFileSync(join(dir, "done", "workflow.toml"), "");
  mkdirSync(join(dir, "wt"), { recursive: true });
  writeFileSync(join(dir, "wt", ".git"), "gitdir: ../fresh/.git/worktrees/wt\n");
  mkdirSync(join(dir, "plain"), { recursive: true });
  writeFileSync(join(dir, "notes.txt"), "");
  return dir;
}

test("workspaceRepos lists repos without workflow.toml and skips worktrees", () => {
  const dir = workspace();
  const r = workspaceRepos(dir);
  expect(r.todo).toEqual([join(dir, "fresh")]);
  expect(r.skipped.map((s) => s.path)).toEqual([join(dir, "done"), join(dir, "wt")]);
});

test("saw init --workspace is a dry run until --apply", () => {
  const dir = workspace();
  expect(run(["init", "--workspace", dir], dir)).toBe(0);
  expect(existsSync(join(dir, "fresh", "workflow.toml"))).toBe(false);
  expect(run(["init", "--workspace", dir, "--apply"], dir)).toBe(0);
  expect(existsSync(join(dir, "fresh", "workflow.toml"))).toBe(true);
  expect(existsSync(join(dir, "wt", "workflow.toml"))).toBe(false);
  expect(existsSync(join(dir, "plain", "workflow.toml"))).toBe(false);
});

test("saw init --workspace refuses a missing directory", () => {
  // A fresh directory, never the shared temp dir itself, as the command's cwd.
  const dir = mkdtempSync(join(tmpdir(), "saw-workspace-missing-"));
  expect(run(["init", "--workspace", join(dir, "no-such-dir")], dir)).toBe(1);
});
