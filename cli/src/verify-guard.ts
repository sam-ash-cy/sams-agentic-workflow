// verify.mode = "hard" (with features.verify_hook): in a saw project with an open
// task, saw guard denies git commit, git push and gh pr create until the task is
// Verified and its tier is not below the diff's floor. The Stop gate blocks only
// once per stop (stop_hook_active); this is the durable backstop. With no task
// open the existing rules decide.

import type { Table } from "./defaults";
import { belowFloor, currentTask, isSawProject, taskStatus } from "./task";

export const verifyMode = (config: Table): "soft" | "hard" => (((config.verify ?? {}) as { mode?: string }).mode === "soft" ? "soft" : "hard");

export function verifyBlock(config: Table, cwd: string): { decision: "deny"; reason: string } | undefined {
  if (verifyMode(config) !== "hard") return undefined;
  if (!((config.features ?? {}) as Record<string, boolean>).verify_hook || !isSawProject(cwd)) return undefined;
  const task = currentTask(cwd);
  if (!task) return undefined;
  if (task.provisional) {
    return { decision: "deny", reason: `verify: the ${task.tier} / ${task.playbook} task was opened provisionally from the prompt (routing.auto = "open"). Confirm it with \`saw task retier ${task.tier}\` or pick your own with \`saw task start --tier <t> --playbook <p>\`, then verify it (or set verify.mode soft)` };
  }
  const low = belowFloor(cwd, config, task);
  if (low) return { decision: "deny", reason: `verify: ${low}, then verify it (or set verify.mode soft)` };
  const s = taskStatus(cwd, config, task);
  if (s.label === "Verified") return undefined;
  const parts = [s.failed.length ? `failed: ${s.failed.join(", ")}` : "", s.missing.length ? `not run: ${s.missing.join(", ")}` : ""].filter(Boolean);
  return {
    decision: "deny",
    reason: `verify: the ${task.tier} task is ${s.label} (${parts.join("; ")}). Run each with \`saw run <check>\`, or \`saw task record <check> pass|fail --note "..."\` for reviews, before committing, pushing or opening a PR (or set verify.mode soft)`,
  };
}
