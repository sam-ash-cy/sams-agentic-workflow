// verify.mode = "hard" (with features.verify_hook): in a saw project with an open
// task, saw guard denies git commit, git push and gh pr create until the task is
// Verified and its tier is not below the diff's floor. With no task open, it
// denies them while the working tree has changes no Verified task covers (see
// unverifiedChanges); a clean tree, or the one the last Verified task closed on,
// passes to the other rules. The Stop gate blocks only once per stop
// (stop_hook_active); this is the durable backstop.

import type { Table } from "./defaults";
import { currentTask, isSawProject, statusProblems, taskStatus, unverifiedChanges } from "./task";

export const verifyMode = (config: Table): "soft" | "hard" => (((config.verify ?? {}) as { mode?: string }).mode === "hard" ? "hard" : "soft");

export function verifyBlock(config: Table, cwd: string): { decision: "deny"; reason: string } | undefined {
  if (verifyMode(config) !== "hard") return undefined;
  if (!((config.features ?? {}) as Record<string, boolean>).verify_hook || !isSawProject(cwd)) return undefined;
  const task = currentTask(cwd);
  if (!task) {
    const loose = unverifiedChanges(cwd);
    if (!loose.length) return undefined;
    const shown = loose.slice(0, 5).join(", ") + (loose.length > 5 ? ` and ${loose.length - 5} more` : "");
    return {
      decision: "deny",
      reason: `verify: no saw task is open and the working tree has changes no Verified task covers (${shown}). Open a task (\`saw task start --tier <t> --playbook <p>\`, or \`saw task adhoc\` for a one-off edit), run its checks until \`saw task status\` says Verified, then \`saw task end\`, before committing, pushing or opening a PR (or set verify.mode soft)`,
    };
  }
  if (task.provisional) {
    return { decision: "deny", reason: `verify: the ${task.tier} / ${task.playbook} task was opened provisionally from the prompt (routing.auto = "open"). Confirm it with \`saw task retier ${task.tier}\` or pick your own with \`saw task start --tier <t> --playbook <p>\`, then verify it (or set verify.mode soft)` };
  }
  const s = taskStatus(cwd, config, task);
  if (s.floor) return { decision: "deny", reason: `verify: ${s.floor}, then verify it (or set verify.mode soft)` };
  if (s.label === "Verified") return undefined;
  return {
    decision: "deny",
    reason: `verify: the ${task.tier} task is ${s.label} (${statusProblems(s)}). Run each with \`saw run <check>\`, or \`saw task record <check> pass|fail --note "..."\` for reviews, before committing, pushing or opening a PR (or set verify.mode soft)`,
  };
}
