// features.branch_guard: work never happens on the base branch. saw task start
// branches (or opens a worktree) off [branch].base when the session is still on
// it, renames a branch a tool named, and saw guard denies commits on the base,
// and edits during a non-trivial task.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Table } from "./defaults";

export const BRANCH_TYPES = ["feat", "fix", "docs", "refactor", "test", "chore", "ci", "perf", "build", "style", "revert"] as const;
export const GOOD_BRANCH = new RegExp(`^(${BRANCH_TYPES.join("|")})/[a-z0-9]+(-[a-z0-9]+)*$`);
// Names a tool picked (Claude Code, the desktop app's worktrees).
export const AUTO_BRANCH = /^(claude\/|worktree-)/;
// A branch name safe to hand git: never an option (a committed workflow.toml
// could set branch.base = "--upload-pack=<cmd>"), never a range.
export const SAFE_REF = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export interface BranchSettings {
  enabled: boolean;
  base: string;
  mode: "branch" | "worktree" | "auto";
}

export function branchSettings(config: Table): BranchSettings {
  const features = (config.features ?? {}) as Record<string, boolean>;
  const b = (config.branch ?? {}) as { base?: string; mode?: BranchSettings["mode"] };
  return { enabled: !!features.branch_guard, base: b.base || "main", mode: b.mode ?? "auto" };
}

// The branch still needs leaving: the base itself, or one a tool named.
export const onBase = (branch: string, base: string): boolean => branch === base || AUTO_BRANCH.test(branch);

export type Git = (args: string[], cwd: string) => { ok: boolean; out: string };
export const git: Git = (args, cwd) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 15000 });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
};

export function currentBranch(cwd: string, run: Git = git): string {
  const r = run(["branch", "--show-current"], cwd);
  return r.ok ? r.out : "";
}

export interface BranchPlan {
  action: "none" | "branch" | "worktree" | "rename";
  name?: string;
  from?: string;
  path?: string;
  reason?: string;
}

// What saw task start should do. `wanted` is the --branch value, if given.
export function planBranch(s: BranchSettings, tier: string, current: string, wanted: string | undefined, worktrees: boolean, cwd: string): BranchPlan {
  if (!s.enabled || tier === "trivial" || !current || !onBase(current, s.base)) return { action: "none" };
  if (!wanted) return { action: "none", reason: `on ${current}: pass --branch <type>/<kebab-description> to ${current === s.base ? `branch off ${s.base}` : "rename it"}` };
  if (!GOOD_BRANCH.test(wanted)) return { action: "none", reason: `--branch "${wanted}" does not follow <type>/<kebab-description>` };
  // A tool-named branch may already hold the work: rename it, don't leave it behind.
  if (current !== s.base) return { action: "rename", name: wanted, from: current };
  const big = tier === "complex" || tier === "critical";
  const worktree = worktrees && (s.mode === "worktree" || (s.mode === "auto" && big));
  if (!worktree) return { action: "branch", name: wanted };
  return { action: "worktree", name: wanted, path: join(dirname(cwd), `${basename(cwd)}-${wanted.split("/")[1]}`) };
}

// Runs the plan off origin/<base> when the remote has it, else the local base.
export function applyBranch(plan: BranchPlan, s: BranchSettings, cwd: string, run: Git = git): { ok: boolean; message: string } {
  if (plan.action === "none" || !plan.name) return { ok: true, message: plan.reason ?? "" };
  if (plan.action === "rename") {
    const r = run(["branch", "-m", plan.name], cwd);
    return r.ok ? { ok: true, message: `renamed ${plan.from} to ${plan.name}` } : { ok: false, message: `could not rename ${plan.from} to ${plan.name}: ${r.out}` };
  }
  if (!SAFE_REF.test(s.base)) return { ok: false, message: `branch.base "${s.base}" is not a branch name; nothing run` };
  run(["fetch", "--quiet", "origin", s.base], cwd);
  const from = run(["rev-parse", "--verify", "--quiet", `origin/${s.base}`], cwd).ok ? `origin/${s.base}` : s.base;
  const args = plan.action === "branch"
    ? ["switch", "-c", plan.name, "--no-track", from]
    : ["worktree", "add", "-b", plan.name, plan.path as string, from];
  const r = run(args, cwd);
  if (!r.ok) return { ok: false, message: `could not ${plan.action === "branch" ? "create branch" : "add worktree"} ${plan.name}: ${r.out}` };
  return { ok: true, message: plan.action === "branch" ? `branched ${plan.name} off ${from}` : `worktree ${plan.path} on ${plan.name} off ${from}: continue the task there` };
}

// A task opened in a worktree leaves a pointer here, so the guard keeps edits
// off the base checkout until that task ends (its task.json goes away).
const pointer = (cwd: string): string => join(cwd, ".saw", "worktree.json");

export function markWorktreeTask(cwd: string, path: string, name: string): void {
  mkdirSync(join(cwd, ".saw"), { recursive: true });
  writeFileSync(pointer(cwd), JSON.stringify({ path, name }) + "\n");
}

export function worktreeTask(cwd: string): { path: string; name: string } | undefined {
  try {
    const p = JSON.parse(readFileSync(pointer(cwd), "utf8")) as { path?: string; name?: string };
    return p.path && p.name && existsSync(join(p.path, ".saw", "task.json")) ? { path: p.path, name: p.name } : undefined;
  } catch {
    return undefined;
  }
}
