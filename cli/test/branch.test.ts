import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyBranch, branchSettings, markWorktreeTask, planBranch, type Git } from "../src/branch";
import { resolve } from "../src/config";
import { baseBranchGuard } from "../src/guard";
import { startTask, taskSteps } from "../src/task";

const tmp = (p: string): string => mkdtempSync(join(tmpdir(), p));

function config(toml = ""): ReturnType<typeof resolve>["config"] {
  const dir = tmp("saw-br-");
  writeFileSync(join(dir, "workflow.toml"), toml);
  const none = join(dir, "none.toml");
  return resolve(dir, {}, { global: none, project: none, local: join(dir, "workflow.toml") }).config;
}

test("branch settings default to main/auto and follow the layer", () => {
  expect(branchSettings(config())).toEqual({ enabled: true, base: "main", mode: "auto" });
  expect(branchSettings(config('[branch]\nbase = "develop"\nmode = "branch"\n'))).toMatchObject({ base: "develop", mode: "branch" });
  expect(branchSettings(config("[features]\nbranch_guard = false\n")).enabled).toBe(false);
});

test("planBranch: branch for standard, worktree for complex, nothing off base", () => {
  const s = branchSettings(config());
  expect(planBranch(s, "standard", "main", "feat/x-y", true, "/r/repo")).toEqual({ action: "branch", name: "feat/x-y" });
  expect(planBranch(s, "complex", "main", "feat/x-y", true, "/r/repo")).toMatchObject({ action: "worktree", name: "feat/x-y" });
  expect(planBranch(s, "complex", "main", "feat/x-y", false, "/r/repo").action).toBe("branch");
  expect(planBranch(s, "standard", "claude/nice-hodgkin", "fix/a", true, "/r")).toEqual({ action: "rename", name: "fix/a", from: "claude/nice-hodgkin" });
  expect(planBranch(s, "standard", "feat/other", "feat/x", true, "/r").action).toBe("none");
  expect(planBranch(s, "trivial", "main", undefined, true, "/r")).toEqual({ action: "none" });
  expect(planBranch(s, "standard", "main", undefined, true, "/r").reason).toContain("--branch");
  expect(planBranch(s, "standard", "main", "Bad_Name", true, "/r").reason).toContain("does not follow");
});

test("applyBranch branches off origin/<base> when it exists", () => {
  const calls: string[][] = [];
  const fake: Git = (args) => { calls.push(args); return { ok: true, out: "" }; };
  const s = branchSettings(config());
  expect(applyBranch({ action: "branch", name: "feat/x" }, s, "/r", fake).ok).toBe(true);
  expect(calls.at(-1)).toEqual(["switch", "-c", "feat/x", "--no-track", "origin/main"]);
});

test("guard denies commits on base and edits during a non-trivial task", () => {
  const c = config();
  const dir = tmp("saw-brg-");
  const onMain = (): string => "main";
  expect(baseBranchGuard(c, "Bash", "git commit -m x", dir, onMain)?.decision).toBe("deny");
  expect(baseBranchGuard(c, "Bash", "git status", dir, onMain)).toBeUndefined();
  const f = join(dir, "a.ts");
  expect(baseBranchGuard(c, "Edit", "", dir, onMain, f)).toBeUndefined();
  startTask(dir, "standard", "feature");
  expect(baseBranchGuard(c, "Edit", "", dir, onMain, f)?.decision).toBe("deny");
  expect(baseBranchGuard(c, "Write", "", dir, onMain, join(tmpdir(), "plans", "p.md"))).toBeUndefined();
  expect(baseBranchGuard(c, "Edit", "", dir, () => "feat/x", f)).toBeUndefined();
  expect(baseBranchGuard(config("[features]\nbranch_guard = false\n"), "Bash", "git commit", dir, onMain)).toBeUndefined();
});

test("taskSteps names the base branch", () => {
  expect(taskSteps(config('[branch]\nbase = "develop"\n'), "standard").join(" ")).toContain("own branch off develop");
  expect(taskSteps(config(), "trivial").join(" ")).not.toContain("own branch");
});

test("a tool-named branch is renamed, not left behind", () => {
  const calls: string[][] = [];
  const fake: Git = (args) => { calls.push(args); return { ok: true, out: "" }; };
  const r = applyBranch({ action: "rename", name: "fix/a", from: "claude/x" }, branchSettings(config()), "/r", fake);
  expect(r.message).toBe("renamed claude/x to fix/a");
  expect(calls).toEqual([["branch", "-m", "fix/a"]]);
});

test("guard catches quoted commits and edits on base while a worktree holds the task", () => {
  const c = config();
  const onMain = (): string => "main";
  const dir = tmp("saw-brw-");
  expect(baseBranchGuard(c, "Bash", `bash -c "git commit -m x"`, dir, onMain)?.decision).toBe("deny");
  const wt = tmp("saw-brw-wt-");
  startTask(wt, "complex", "feature");
  markWorktreeTask(dir, wt, "feat/x");
  expect(baseBranchGuard(c, "NotebookEdit", "", dir, onMain, join(dir, "n.ipynb"))?.reason).toContain("worktree");
  rmSync(join(wt, ".saw", "task.json"));
  expect(baseBranchGuard(c, "Edit", "", dir, onMain, join(dir, "a.ts"))).toBeUndefined();
});

test("a branch.base that is a git option is refused before git runs", () => {
  const calls: string[][] = [];
  const fake: Git = (args) => (calls.push(args), { ok: true, out: "" });
  const s = { ...branchSettings({ features: { branch_guard: true } }), base: "--upload-pack=touch pwned" };
  const r = applyBranch({ action: "branch", name: "feat/x" }, s, "/r", fake);
  expect(r.ok).toBe(false);
  expect(r.message).toContain("not a branch name");
  expect(calls).toEqual([]);
});
