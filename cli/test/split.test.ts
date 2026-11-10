import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySplit, parseSplit, planSplit } from "../src/split";

const PLAN = `# Plan

Shared context for every step.

## Step 1: cost band \`feat/cost-band\`
Show spend above the prompt.
- tests first

## Step 2: docs \`docs/cost\`
Document it.

## Verification
Run the suite.
`;

test("each heading that names a branch is one unit, the rest of the plan is context", () => {
  const s = parseSplit(PLAN);
  expect(s.units.map((u) => u.branch)).toEqual(["feat/cost-band", "docs/cost"]);
  expect(s.units[0]!.title).toBe("Step 1: cost band");
  expect(s.units[0]!.brief).toContain("- tests first");
  expect(s.units[0]!.brief).not.toContain("Document it");
  expect(s.units[1]!.brief).not.toContain("Run the suite");
  expect(s.context).toContain("Shared context");
  expect(s.problems).toEqual([]);
});

test("a bad branch name or a repeated one is a problem", () => {
  const s = parseSplit("## A `feature/X`\nx\n## B `feat/a`\ny\n## C `feat/a`\nz\n");
  expect(s.problems.join("\n")).toContain("feature/X");
  expect(s.problems.join("\n")).toContain("feat/a");
});

test("fewer than two units is not worth splitting", () => {
  expect(parseSplit("## A `feat/a`\nx\n").problems.join("\n")).toContain("at least two");
});

test("planSplit puts each worktree beside the repo", () => {
  const units = planSplit(parseSplit(PLAN), "/w/repo");
  expect(units[0]!.path.replaceAll("\\", "/")).toBe("/w/repo-cost-band");
  expect(units[1]!.path.replaceAll("\\", "/")).toBe("/w/repo-cost");
});

test("applySplit adds a worktree per unit off the base, with its brief", () => {
  const root = mkdtempSync(join(tmpdir(), "saw-split-"));
  const repo = join(root, "repo");
  const git = (cwd: string, ...a: string[]) => Bun.spawnSync(["git", ...a], { cwd, stdout: "pipe", stderr: "pipe" });
  Bun.spawnSync(["git", "init", "-q", "-b", "main", repo]);
  git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "base");
  const results = applySplit(planSplit(parseSplit(PLAN), repo), parseSplit(PLAN).context, "main", repo);
  expect(results.every((r) => r.ok)).toBe(true);
  const wt = join(root, "repo-cost-band");
  expect(git(wt, "branch", "--show-current").stdout.toString().trim()).toBe("feat/cost-band");
  const brief = readFileSync(join(wt, ".saw", "brief.md"), "utf8");
  expect(brief).toContain("Show spend above the prompt.");
  expect(brief).toContain("Shared context");
  expect(brief).not.toContain("Document it");
  // Running it again leaves the existing worktrees alone.
  const again = applySplit(planSplit(parseSplit(PLAN), repo), "", "main", repo);
  expect(again.every((r) => !r.ok && r.message.includes("exists"))).toBe(true);
  expect(existsSync(join(root, "repo-cost"))).toBe(true);
});

test("a branch.base that is a git option is refused before git runs", () => {
  const root = mkdtempSync(join(tmpdir(), "saw-split-"));
  const r = applySplit(planSplit(parseSplit(PLAN), join(root, "repo")), "", "--upload-pack=touch pwned", join(root, "repo"));
  expect(r.every((x) => !x.ok && x.message.includes("not a branch name"))).toBe(true);
  expect(existsSync(join(root, "repo-cost-band"))).toBe(false);
});
