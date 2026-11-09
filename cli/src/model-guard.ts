// Per-role models, enforced by hooks instead of instructions. A saw agent only
// runs on models.roles.<role> if the Agent call asks for it, and the main
// session keeps the model it started with, so:
//  - modelHook (PreToolUse on Agent) denies a saw agent call on the wrong model;
//  - implementerEdit (PreToolUse on edits) stops the main session writing
//    source while features.implementer says the implementer agent should;
//  - planModelWarning (SessionStart) can only warn: no hook can change the
//    main session's model once it has started.

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { modelFor, sessionSettings } from "./agents";
import type { Table } from "./defaults";
import { currentTask, isSawProject } from "./task";

const PLUGIN_ROOT = join(import.meta.dir, "..", "..");

// The agent file's role and model, or undefined when it isn't a saw role agent.
export function agentRole(subagentType: string, pluginDir = PLUGIN_ROOT): { role: string; model?: string } | undefined {
  // "sams-agentic-workflow:implementer" or plain "implementer".
  const name = subagentType.replace(/^sams-agentic-workflow:/, "");
  if (!/^[a-z][a-z0-9-]*$/.test(name)) return undefined;
  const path = join(pluginDir, "agents", `${name}.md`);
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  const role = /^role:[ \t]*(\S+)/m.exec(text)?.[1];
  if (!role) return undefined;
  return { role, model: /^model:[ \t]*(\S+)/m.exec(text)?.[1] };
}

// "sonnet" matches "sonnet" and full ids such as "claude-sonnet-5-5".
export const sameModel = (want: string, got: string): boolean => {
  const w = want.toLowerCase();
  const g = got.toLowerCase();
  return w === g || g.includes(w) || w.includes(g);
};

// The open task's tier, so [models.phases.<phase>.<tier>] applies.
function openTier(cwd: string): string | undefined {
  try {
    return isSawProject(cwd) ? currentTask(cwd)?.tier : undefined;
  } catch {
    return undefined;
  }
}

// Which setting a phase's model came from, for messages.
function source(config: Table, role: string, tier?: string): string {
  const phase = ((config.models ?? {}) as { phases?: Record<string, Record<string, unknown>> }).phases?.[role];
  if (!phase) return `models.roles.${role}`;
  return tier && typeof phase[tier] === "object" && (phase[tier] as { model?: unknown }).model ? `models.phases.${role}.${tier}` : `models.phases.${role}`;
}

export function guardAgent(config: Table, toolInput: { subagent_type?: unknown; model?: unknown }, pluginDir = PLUGIN_ROOT, cwd = process.cwd()): string | undefined {
  if (typeof toolInput.subagent_type !== "string") return undefined;
  const agent = agentRole(toolInput.subagent_type, pluginDir);
  if (!agent) return undefined;
  const tier = openTier(cwd);
  const want = modelFor(config, agent.role, tier);
  if (want === "inherit") return undefined;
  const from = source(config, agent.role, tier);
  // An explicit model wins; otherwise the agent file's frontmatter applies.
  const got = typeof toolInput.model === "string" && toolInput.model ? toolInput.model : agent.model;
  if (!got || got === "inherit") return `${toolInput.subagent_type} would inherit the session's model, but ${from} is ${want}: pass model: "${want}"`;
  if (sameModel(want, got)) return undefined;
  return `${toolInput.subagent_type} would run on ${got}, but ${from} is ${want}: pass model: "${want}" (or run saw sync to fix the agent file)`;
}

// Files the main session may still write while the implementer owns source:
// docs, notes, plans, saw state and settings layers (the edit guard asks for those).
const NOT_SOURCE = /(^|[\\/])(docs|\.saw|\.claude|\.trail|graft)[\\/]|\.(md|mdx|txt)$|(^|[\\/])workflow(\.local)?\.toml$/i;

// features.implementer on, a standard-or-higher task open and a source file in
// this repo edited by the main session (hook input has no agent_id). Denied in
// the implement phase, asked otherwise (plan and review shouldn't write source).
export function implementerEdit(config: Table, input: { agent_id?: unknown; tool_input?: { file_path?: unknown; notebook_path?: unknown } }, cwd = process.cwd()): { decision: "deny" | "ask"; reason: string } | undefined {
  if (!(config.features as Record<string, boolean>).implementer || input.agent_id || !isSawProject(cwd)) return undefined;
  const task = currentTask(cwd);
  if (!task || task.tier === "trivial") return undefined;
  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (typeof file !== "string") return undefined;
  const rel = relative(cwd, resolve(cwd, file));
  if (rel.startsWith("..") || isAbsolute(rel) || NOT_SOURCE.test(rel)) return undefined;
  const model = modelFor(config, "implement", task.tier);
  const how = `hand this unit to the implementer agent${model === "inherit" ? "" : ` with model: "${model}"`}`;
  if (task.phase === "implement") return { decision: "deny", reason: `features.implementer is on and the task is in its implement phase: ${how} (${rel})` };
  return { decision: "ask", reason: `features.implementer is on: the main session plans and reviews; ${how}, or approve this edit (${rel})` };
}

// SessionStart: the plan step runs in the main session, on whatever model it
// started with. Only an explicit models.roles.plan is checked.
export function planModelWarning(config: Table, input: { model?: unknown }, cwd = process.cwd()): Record<string, unknown> | undefined {
  const models = (config.models ?? {}) as { roles?: Record<string, string>; phases?: Record<string, Record<string, unknown>> };
  const tier = openTier(cwd);
  // Only a configured plan model is checked; an effort-only plan phase isn't.
  const plan = models.phases?.plan;
  const tierPlan = tier && plan && typeof plan[tier] === "object" ? (plan[tier] as { model?: unknown }) : undefined;
  if ((!models.roles?.plan && !plan?.model && !tierPlan?.model) || typeof input.model !== "string" || !input.model) return undefined;
  const want = modelFor(config, "plan", tier);
  // "opusplan" runs plan mode on Opus: it satisfies an opus plan phase.
  if (want === "inherit" || sameModel(want, input.model)) return undefined;
  const fix = sessionSettings(config, tier).model === "opusplan" ? "run `saw sync --session` (sets model opusplan) and restart, or /model opusplan" : `restart with \`claude --model ${want}\` or /model ${want} before planning`;
  const message = `[saw] this session runs on ${input.model}, but ${source(config, "plan", tier)} is ${want}. A hook can't switch the main session's model: ${fix}.`;
  return { systemMessage: message, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: message } };
}
