// Session handoff: the Stop hook writes .saw/handoff.json (the open task, its
// branch, latest plan and check state); saw resume restores the task in a new
// session and switches back to the branch when the tree is clean.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checksSince, currentTask, restoreTask, type Task } from "./task";

export interface Card {
  task: Task;
  branch?: string;
  plan?: string;
  passed: string[];
  failing: string[];
  updated: string;
}

export type Git = (args: string[], cwd: string) => { ok: boolean; out: string };
const realGit: Git = (args, cwd) => {
  const p = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { ok: p.exitCode === 0, out: p.stdout.toString().trim() };
};

const cardPath = (cwd: string): string => join(cwd, ".saw", "handoff.json");

// Newest .md in docs/plans (the queue file excluded), relative to cwd.
function latestPlan(cwd: string): string | undefined {
  const d = join(cwd, "docs", "plans");
  if (!existsSync(d)) return undefined;
  const files = readdirSync(d).filter((f) => f.endsWith(".md") && f !== "queue.md");
  files.sort((a, b) => statSync(join(d, b)).mtimeMs - statSync(join(d, a)).mtimeMs);
  return files[0] ? `docs/plans/${files[0]}` : undefined;
}

export function writeCard(cwd: string, git: Git = realGit): Card | undefined {
  const task = currentTask(cwd);
  if (!task) return undefined;
  const checks = [...checksSince(cwd, task.from).values()];
  const branch = git(["branch", "--show-current"], cwd);
  const card: Card = {
    task,
    branch: branch.ok && branch.out ? branch.out : undefined,
    plan: latestPlan(cwd),
    passed: checks.filter((c) => c.status === "pass").map((c) => c.name),
    failing: checks.filter((c) => c.status === "fail").map((c) => c.name),
    updated: new Date().toISOString(),
  };
  mkdirSync(join(cwd, ".saw"), { recursive: true });
  writeFileSync(cardPath(cwd), JSON.stringify(card, null, 2) + "\n");
  return card;
}

export function readCard(cwd: string): Card | undefined {
  try {
    return JSON.parse(readFileSync(cardPath(cwd), "utf8")) as Card;
  } catch {
    return undefined;
  }
}

// One line for a new session (startup or clear; a compacted or resumed one keeps
// its context) when a card waits for the open task, or for no task at all.
// task.json outlives the session, so an open task alone doesn't mean it's picked up.
export function resumeHint(cwd: string, source?: string): string | undefined {
  if (source === "compact" || source === "resume") return undefined;
  const c = readCard(cwd);
  if (!c) return undefined;
  const open = currentTask(cwd);
  if (open && open.started !== c.task.started) return undefined;
  return `saw: an unfinished ${c.task.tier}/${c.task.playbook} task${c.branch ? ` on ${c.branch}` : ""} from ${c.updated.slice(0, 16).replace("T", " ")}; run \`saw resume\` to pick up its branch, plan and failing checks`;
}

export function resume(cwd: string, git: Git = realGit): { lines: string[]; ok: boolean } {
  const c = readCard(cwd);
  if (!c) return { ok: false, lines: ["saw resume: no handoff card (.saw/handoff.json); start a task with saw task start"] };
  const lines: string[] = [];
  const open = currentTask(cwd);
  if (open && open.started !== c.task.started) return { ok: false, lines: [`saw resume: a different task (${open.tier}/${open.playbook}) is open; end it first with saw task end`] };
  if (!open) restoreTask(cwd, c.task);
  lines.push(`task: ${c.task.tier} / ${c.task.playbook}${c.task.phase ? ` · phase: ${c.task.phase}` : ""}${open ? "" : " (restored)"}`);
  if (c.branch) {
    const now = git(["branch", "--show-current"], cwd).out;
    if (now === c.branch) lines.push(`branch: ${c.branch}`);
    else if (git(["status", "--porcelain"], cwd).out === "" && git(["switch", c.branch], cwd).ok) lines.push(`branch: switched ${now || "(detached)"} -> ${c.branch}`);
    else lines.push(`branch: on ${now || "(detached)"}, card says ${c.branch}; commit or stash, then git switch ${c.branch}`);
  }
  if (c.plan) lines.push(`plan: ${c.plan} (read it before continuing)`);
  if (c.passed.length) lines.push(`passed: ${c.passed.join(", ")}`);
  if (c.failing.length) lines.push(`failing: ${c.failing.join(", ")}`);
  return { ok: true, lines };
}
