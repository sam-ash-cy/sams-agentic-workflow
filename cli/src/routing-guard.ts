// routing.mode = "hard" (with features.verify_hook): in a saw project, saw guard
// denies edits to files in the repo until a task is open. Routing is the one
// step everything else (tests-first, reviews, budgets, the verify gate) hangs on.

import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Table } from "./defaults";
import { currentTask, isSawProject, staleMessage, staleTask } from "./task";

export const routingMode = (config: Table): "soft" | "hard" => (((config.routing ?? {}) as { mode?: string }).mode === "hard" ? "hard" : "soft");

// saw's own state, Claude's config, and plan files are never the work being routed.
const EXEMPT = /^(\.saw|\.claude)(\/|$)|^plans\/[^/]+\.md$/;

export function routingEdit(config: Table, filePath: string | undefined, cwd: string, sessionId?: string): { decision: "deny"; reason: string } | undefined {
  if (!filePath || routingMode(config) !== "hard") return undefined;
  if (!((config.features ?? {}) as Record<string, boolean>).verify_hook || !isSawProject(cwd)) return undefined;
  const rel = relative(resolve(cwd), resolve(cwd, filePath));
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  if (EXEMPT.test(rel.split(sep).join("/"))) return undefined;
  // The open task is another session's: pick it up or close it before editing under it.
  const stale = staleTask(cwd, sessionId);
  if (stale) return { decision: "deny", reason: `routing: ${staleMessage(stale)}, then edit ${rel} (or set routing.mode soft)` };
  if (currentTask(cwd)) return undefined;
  return {
    decision: "deny",
    reason: `routing: no task is open. Use the router skill to classify the work, then run \`saw task start --tier <t> --playbook <p>\` (or \`saw task adhoc\` for a one-off edit), then edit ${rel} (or set routing.mode soft)`,
  };
}
