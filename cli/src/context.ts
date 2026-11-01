// `saw context`: a UserPromptSubmit hook that nudges toward /compact as the
// session's context fills. Hooks can't run /compact themselves, so this tells
// both the user (systemMessage) and Claude (additionalContext), once per
// threshold per session. Built-in auto-compaction still applies at the limit.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Table } from "./defaults";
import { transcriptTokens } from "./metrics";
import { currentTask, isSawProject } from "./task";

// With no task open, routing depends on the agent picking the router skill
// among every other skill it has, so say it on each prompt until a task opens.
export function routerNudge(cwd: string, config: Table): Record<string, unknown> | undefined {
  const features = (config.features ?? {}) as Record<string, boolean>;
  if (!features.verify_hook || !isSawProject(cwd) || currentTask(cwd)) return undefined;
  const message = "No saw task is open. If this prompt asks for a code or config change, use the router skill first: classify it, then run `saw task start --tier <t> --playbook <p>`. Skip this for questions.";
  return {
    systemMessage: "saw: no task open; the router skill opens one",
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: `[saw context] ${message}` },
  };
}

// Current context size = the prompt tokens of the latest assistant turn
// (input + cache creation + cache reads). The transcript isn't a documented
// API, so anything unexpected yields undefined and the hook stays silent.
export function contextTokens(transcript: string): number | undefined {
  if (!existsSync(transcript)) return undefined;
  const lines = readFileSync(transcript, "utf8").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]!.trim()) continue;
    try {
      const usage = (JSON.parse(lines[i]!) as { message?: { usage?: Record<string, unknown> } }).message?.usage;
      if (!usage) continue;
      let total = 0;
      for (const key of ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]) {
        if (typeof usage[key] === "number") total += usage[key] as number;
      }
      return total;
    } catch {
      // A partial last line while the session is still writing: look further back.
    }
  }
  return undefined;
}

export interface Nudge {
  share: number;
  level: "compact" | "handoff";
  message: string;
}

export function nudgeFor(config: Table, tokens: number, alreadyFired: number[]): Nudge | undefined {
  const c = (config.context ?? {}) as { window_tokens?: number; suggest_compact_at?: number[]; handoff_at?: number };
  const share = tokens / (c.window_tokens || 200000);
  const pct = Math.round(share * 100);
  // Highest threshold crossed that hasn't fired yet; lower ones are implied.
  const handoff = c.handoff_at ?? 0.85;
  if (share >= handoff && !alreadyFired.includes(handoff)) {
    return {
      share: handoff,
      level: "handoff",
      message: `Context is ${pct}% full. Finish the current step, write a handoff (prompts/handoff.md), then start a fresh session, or /compact now with a focus, e.g. "/compact keep the plan and open findings".`,
    };
  }
  const due = [...(c.suggest_compact_at ?? [])].sort((a, b) => b - a).find((t) => share >= t && t < handoff);
  if (due !== undefined && !alreadyFired.includes(due)) {
    return {
      share: due,
      level: "compact",
      message: `Context is ${pct}% full. At the next natural break (a phase or task boundary), suggest /compact to the user; a fresh session is better if the next task is unrelated.`,
    };
  }
  return undefined;
}

interface HookInput {
  session_id?: string;
  transcript_path?: string;
}

// Returns the hook's JSON output, or undefined to say nothing.
export function contextHook(cwd: string, config: Table, input: HookInput): Record<string, unknown> | undefined {
  const features = (config.features ?? {}) as Record<string, boolean>;
  if (!features.compact_nudge || !input.transcript_path) return undefined;
  const tokens = contextTokens(input.transcript_path);
  if (tokens === undefined) return undefined;

  const statePath = join(cwd, ".saw", "context.json");
  const state = (existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {}) as Record<string, number[]>;
  const session = input.session_id ?? "unknown";
  const fired = state[session] ?? [];
  const nudge = nudgeFor(config, tokens, fired);
  if (!nudge) return undefined;

  // Record this threshold and every lower one, so a jump to 90% doesn't later fire 50%.
  const c = (config.context ?? {}) as { suggest_compact_at?: number[] };
  const lower = (c.suggest_compact_at ?? []).filter((t) => t <= nudge.share);
  state[session] = [...new Set([...fired, nudge.share, ...lower])];
  mkdirSync(join(cwd, ".saw"), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state) + "\n");

  return {
    systemMessage: `saw: ${nudge.message}`,
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: `[saw context] ${nudge.message}` },
  };
}

// Token budget for the open task: tokens spent since it started against
// tokens.budget[tier]. Fires once at warn_at and once at 100% per task.
export function budgetNudge(config: Table, tier: string, spent: number, alreadyFired: number[]): Nudge | undefined {
  const t = (config.tokens ?? {}) as { mode?: string; warn_at?: number; budget?: Record<string, number> };
  const budget = t.budget?.[tier];
  if (!budget) return undefined;
  const share = spent / budget;
  const pct = Math.round(share * 100);
  if (share >= 1 && !alreadyFired.includes(1)) {
    const message = t.mode === "hard"
      ? `This ${tier} task has used ${pct}% of its ${budget}-token budget (hard mode). Stop at the next safe point, write a handoff (prompts/handoff.md) and run saw task end; don't start new work.`
      : `This ${tier} task has used ${pct}% of its ${budget}-token budget. Ask the user whether to continue before doing more.`;
    return { share: 1, level: "handoff", message };
  }
  const warn = t.warn_at ?? 0.8;
  if (share >= warn && share < 1 && !alreadyFired.includes(warn)) {
    return { share: warn, level: "compact", message: `This ${tier} task has used ${pct}% of its ${budget}-token budget; keep the rest of it lean.` };
  }
  return undefined;
}

export function budgetHook(cwd: string, config: Table, task: { tier: string; started: string } | undefined, input: HookInput): Record<string, unknown> | undefined {
  const features = (config.features ?? {}) as Record<string, boolean>;
  if (!features.budgets || !task || !input.transcript_path) return undefined;
  const spent = transcriptTokens(input.transcript_path, task.started);
  if (spent === undefined) return undefined;

  const statePath = join(cwd, ".saw", "budget.json");
  const state = (existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {}) as Record<string, number[]>;
  const fired = state[task.started] ?? [];
  const nudge = budgetNudge(config, task.tier, spent, fired);
  if (!nudge) return undefined;
  // The 100% nudge implies the warning: don't send it afterwards.
  state[task.started] = [...new Set([...fired, nudge.share, ...(nudge.share === 1 ? [(config.tokens as { warn_at?: number }).warn_at ?? 0.8] : [])])];
  mkdirSync(join(cwd, ".saw"), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state) + "\n");
  return {
    systemMessage: `saw: ${nudge.message}`,
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: `[saw budget] ${nudge.message}` },
  };
}
