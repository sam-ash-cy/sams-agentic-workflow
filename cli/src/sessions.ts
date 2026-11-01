// `saw session-hook`: one session per phase, stage or feature ([sessions]).
// PostToolUse records the unit `saw task start --unit` opened and marks it
// finished on a commit or PR. PreToolUse steps in when a session that has
// finished a unit starts a different one: soft warns, hard denies until a
// handoff is written and a fresh session takes over.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Table } from "./defaults";

export const UNITS = ["phase", "stage", "feature"] as const;

const TASK_START = /\b(saw|main\.ts)\s+task\s+start\b/;
// At the start of a command or after a separator, so `echo "git commit"` doesn't count.
const FINISH = /(^|[;&|]\s*)(git\s+commit\b(?!.*--dry-run)|gh\s+pr\s+create\b)/;

interface Unit {
  kind: string;
  id: string;
}

interface SessionState {
  session_id: string;
  current?: Unit;
  finished?: Unit & { at: string };
}

export interface SessionHookInput {
  hook_event_name?: string;
  session_id?: string;
  tool_name?: string;
  tool_input?: { command?: unknown };
  tool_response?: unknown;
}

// One file per session, so sessions sharing a checkout don't overwrite each other.
const statePath = (cwd: string, sessionId: string): string =>
  join(cwd, ".saw", "sessions", `${sessionId.replace(/[^\w-]/g, "_")}.json`);

function load(cwd: string, sessionId: string): SessionState {
  try {
    const s = JSON.parse(readFileSync(statePath(cwd, sessionId), "utf8")) as SessionState;
    if (s.session_id === sessionId) return s;
  } catch {
    // No state yet, or unreadable: start clean.
  }
  return { session_id: sessionId };
}

function save(cwd: string, state: SessionState): void {
  mkdirSync(join(cwd, ".saw", "sessions"), { recursive: true });
  writeFileSync(statePath(cwd, state.session_id), JSON.stringify(state, null, 2) + "\n");
}

// The unit a `saw task start` command opens, if it names one.
export function unitOf(command: string): Unit | undefined {
  if (!TASK_START.test(command)) return undefined;
  const kind = /--unit\s+["']?(\w+)/.exec(command)?.[1];
  if (!kind || !(UNITS as readonly string[]).includes(kind)) return undefined;
  const id = /--unit-id\s+(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(command);
  return { kind, id: (id?.[1] ?? id?.[2] ?? id?.[3] ?? "").trim() };
}

// A Bash call failed if the response reports a non-zero exit or an interrupt.
function failed(response: unknown): boolean {
  if (!response || typeof response !== "object") return false;
  const r = response as { exit_code?: unknown; exitCode?: unknown; interrupted?: unknown };
  const code = r.exit_code ?? r.exitCode;
  return r.interrupted === true || (typeof code === "number" && code !== 0);
}

// A handoff (prompts/handoff.md writes docs/plans/handoff-<date>.md) newer than the finish.
function handoffSince(cwd: string, at: string): boolean {
  const dir = join(cwd, "docs", "plans");
  if (!existsSync(dir)) return false;
  const since = Date.parse(at);
  return readdirSync(dir).some((f) => /^handoff-.*\.md$/.test(f) && statSync(join(dir, f)).mtimeMs >= since);
}

// Returns the hook's JSON output, or undefined to stay silent.
export function sessionHook(cwd: string, config: Table, input: SessionHookInput, now = new Date()): Record<string, unknown> | undefined {
  const command = input.tool_input?.command;
  if (input.tool_name !== "Bash" || typeof command !== "string" || !input.session_id) return undefined;
  const sessions = (config.sessions ?? {}) as { new_per?: string[]; mode?: string };
  const newPer = sessions.new_per ?? [];
  if (!newPer.length) return undefined;
  const unit = unitOf(command);

  if (input.hook_event_name === "PostToolUse") {
    if (failed(input.tool_response) || (!unit && !FINISH.test(command))) return undefined;
    const state = load(cwd, input.session_id);
    // A commit with no unit open finishes nothing; one chained before a task start finishes the old unit first.
    if (FINISH.test(command) && state.current) state.finished = { ...state.current, at: now.toISOString() };
    if (unit) state.current = unit;
    save(cwd, state);
    return undefined;
  }

  if (!unit || !newPer.includes(unit.kind)) return undefined;
  const state = load(cwd, input.session_id);
  const chained = FINISH.test(command) && state.current ? { ...state.current, at: now.toISOString() } : undefined;
  const finished = state.finished ?? chained;
  // Nothing finished yet, or a follow-up within the same unit.
  if (!finished || (unit.id && unit.id === finished.id)) return undefined;
  const done = finished.id ? `${finished.kind} ${finished.id}` : "a unit of work";
  const next = `${unit.kind}${unit.id ? ` ${unit.id}` : ""}`;
  if (sessions.mode === "hard") {
    const step = handoffSince(cwd, finished.at)
      ? "The handoff is written; start a fresh session for it"
      : "Write a handoff (prompts/handoff.md) and start a fresh session for it";
    const reason = `saw sessions: this session finished ${done}; ${next} needs its own session (sessions.mode = hard). ${step}: ask the user, or \`claude -p\` if autonomy.actions.spawn_sessions allows.`;
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
  }
  const warning = `saw sessions: this session finished ${done}; ${next} should start in a fresh session. Suggest a handoff (prompts/handoff.md) and a new session.`;
  return { systemMessage: warning, hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: warning } };
}
