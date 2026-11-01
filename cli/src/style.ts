// Response style: the effective tone and word cap for this task, and
// `saw style-check`, a Stop hook that counts the prose words in the last reply.
// Precedence for the cap: task override > style.by_tier[tier] > style.max_words.

import { existsSync, readFileSync } from "node:fs";
import type { Table } from "./defaults";
import { currentTask, type Task } from "./task";

export const TONES = ["normal", "structured", "detailed", "verbose"] as const;

export interface Style {
  tone: string;
  maxWords: number;
  mode: "soft" | "hard";
}

export function effectiveStyle(config: Table, task?: Task): Style {
  const s = (config.style ?? {}) as { tone?: string; max_words?: number; by_tier?: Record<string, number>; mode?: string };
  const tierCap = task ? s.by_tier?.[task.tier] : undefined;
  return {
    tone: task?.style?.tone ?? s.tone ?? "normal",
    maxWords: task?.style?.max_words || tierCap || s.max_words || 250,
    mode: s.mode === "hard" ? "hard" : "soft",
  };
}

export const styleLine = (s: Style): string => `Style: ${s.tone}, ≤${s.maxWords} words`;

// Prose words: fenced code blocks (diffs, tool output) and inline code removed,
// then markdown punctuation that isn't a word (table pipes, bullets, rules) dropped.
export function proseWords(text: string): number {
  const prose = text
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(^[ \t]*\1[ \t]*$|(?![\s\S]))/gm, " ")
    .replace(/`[^`\n]*`/g, " ");
  return prose.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

interface Entry {
  type?: string;
  message?: { role?: string; content?: unknown };
}

const texts = (content: unknown): string[] =>
  typeof content === "string"
    ? [content]
    : Array.isArray(content)
      ? content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text as string)
      : [];

// The last reply = every assistant text block after the latest user prompt
// (tool results come back as user entries too, so those don't end the reply).
// The transcript isn't a documented API: anything unexpected yields undefined.
export function lastReply(transcript: string): string | undefined {
  if (!existsSync(transcript)) return undefined;
  const parts: string[] = [];
  for (const line of readFileSync(transcript, "utf8").split("\n").reverse()) {
    if (!line.trim()) continue;
    let e: Entry;
    try {
      e = JSON.parse(line) as Entry;
    } catch {
      continue;
    }
    const role = e.message?.role ?? e.type;
    if (role === "assistant") parts.unshift(...texts(e.message?.content));
    else if (role === "user" && texts(e.message?.content).length) break;
  }
  return parts.length ? parts.join("\n\n") : undefined;
}

interface HookInput {
  stop_hook_active?: boolean;
  transcript_path?: string;
  last_assistant_message?: string;
}

// Returns the hook's JSON output, or undefined to say nothing.
export function styleCheck(cwd: string, config: Table, input: HookInput): Record<string, unknown> | undefined {
  const features = (config.features ?? {}) as Record<string, boolean>;
  if (!features.style_hook) return undefined;
  const reply = typeof input.last_assistant_message === "string"
    ? input.last_assistant_message
    : typeof input.transcript_path === "string" ? lastReply(input.transcript_path) : undefined;
  if (reply === undefined) return undefined;
  const style = effectiveStyle(config, currentTask(cwd));
  const words = proseWords(reply);
  if (words <= style.maxWords) return undefined;
  const over = `The last reply has ${words} words of prose; the cap is ${style.maxWords} (${style.tone} tone, code blocks don't count).`;
  // Hard mode asks for one rewrite; a second stop in a row goes through so it can't loop.
  if (style.mode === "hard" && !input.stop_hook_active) {
    return { decision: "block", reason: `${over} Rewrite it within the cap: keep the verification label and any commands, cut restated context and narration.` };
  }
  return { systemMessage: `saw: ${over}` };
}
