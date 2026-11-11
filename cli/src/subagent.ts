// SubagentStop: what a subagent edited, for the open task. Its edits already land
// in the working tree (so the tier floor's git diff counts them) and pass through
// saw guard (subagent tool calls carry the parent session_id plus an agent_id).
// This hook makes them visible: a `subagent.edits` event against the open task,
// and with no task open the same untasked-edit marker a main-session edit sets,
// so the Stop gate asks for a task.

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { Table } from "./defaults";
import { logEvent } from "./events";
import { currentTask, isSawProject, markUntaskedEdit } from "./task";

const EDIT_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
// A transcript is read whole; past this size the hook gives up rather than stall a Stop.
const MAX_TRANSCRIPT = 20_000_000;

// File paths the subagent's edit tools targeted, in order, without repeats.
// The transcript format isn't a documented API: anything unexpected is skipped.
export function subagentEdits(transcript: string): string[] {
  try {
    if (!existsSync(transcript) || statSync(transcript).size > MAX_TRANSCRIPT) return [];
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const line of readFileSync(transcript, "utf8").split("\n")) {
    if (!line.includes('"tool_use"')) continue;
    try {
      const content = (JSON.parse(line) as { message?: { content?: unknown } }).message?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content as { type?: unknown; name?: unknown; input?: { file_path?: unknown; notebook_path?: unknown } }[]) {
        if (c.type !== "tool_use" || !EDIT_TOOLS.includes(String(c.name))) continue;
        const f = c.input?.file_path ?? c.input?.notebook_path;
        if (typeof f === "string" && f && !files.includes(f)) files.push(f);
      }
    } catch {
      // A partial or foreign line: skip it.
    }
  }
  return files;
}

export function subagentHook(
  cwd: string,
  config: Table,
  input: { agent_transcript_path?: unknown; agent_type?: unknown; agent_id?: unknown },
): string[] {
  if (!isSawProject(cwd) || typeof input.agent_transcript_path !== "string") return [];
  // Only this project's files: a subagent in its own worktree (.claude/worktrees/) or another repo
  // is that tree's work, and .saw/ and .claude/ are exempt from the routing guard too.
  const inside = subagentEdits(input.agent_transcript_path)
    .map((f) => relative(cwd, resolve(cwd, f)))
    .filter((rel) => rel && !rel.startsWith("..") && !isAbsolute(rel) && !/^\.(saw|claude)([\\/]|$)/.test(rel));
  if (!inside.length) return [];
  const agent = typeof input.agent_type === "string" ? input.agent_type : "subagent";
  const task = currentTask(cwd);
  if (task) {
    logEvent(cwd, config, "info", "subagent.edits", `${agent} edited ${inside.length} file(s) under the ${task.tier} task`, { agent, files: inside.slice(0, 50), tier: task.tier });
  } else {
    markUntaskedEdit(cwd, inside[0]);
    logEvent(cwd, config, "warn", "subagent.edits", `${agent} edited ${inside.length} file(s) with no saw task open`, { agent, files: inside.slice(0, 50) });
  }
  return inside;
}
