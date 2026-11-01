// `saw guard`: a PreToolUse hook that enforces [safety] and [autonomy]
// mechanically, instead of relying on instructions. "never" denies, "ask"
// hands the decision to the user, anything else allows.

import { homedir } from "node:os";
import { isAbsolute, relative, resolve as resolvePath } from "node:path";
import type { Table } from "./defaults";

type Decision = "deny" | "ask";
type Verdict = { decision: Decision; reason: string } | undefined;

const SPAWN = /\bclaude\s+(-p|--print)\b/;
const WORKTREE = /\bgit\s+worktree\s+add\b/;

// Shell commands that count as each autonomy action.
const ACTIONS: Record<string, RegExp> = {
  push: /\bgit\s+push\b/,
  commit: /\bgit\s+commit\b/,
  open_pr: /\bgh\s+pr\s+create\b/,
  add_dependency: /\b(bun|npm|pnpm|yarn)\s+(add|install|i)\s+\S|\bcomposer\s+require\b|\bpip\s+install\s+\S|\bcargo\s+add\b/,
  // A new headless Claude session.
  spawn_sessions: SPAWN,
  // The [review_session] sub-session; one after the other, so features.parallel_sessions doesn't apply.
  spawn_review: /\b(saw|main\.ts)\s+review-session\s+run\b(?!.*--dry-run)/,
};

// safety.destructive_approval / deploy_approval: always ask, whatever the autonomy level.
const DESTRUCTIVE = /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s)|\bgit\s+branch\s+-D\b|\b(drop|truncate)\s+(table|database)\b|\bmigrate:fresh\b|\bdb:wipe\b/i;
const DEPLOY = /\b(terraform|tofu)\s+(apply|destroy)\b|\bkubectl\s+(apply|delete)\b|\bhelm\s+(install|upgrade|uninstall)\b|\b(fly|flyctl)\s+deploy\b|\bvercel\b.*--prod\b|\bgh\s+release\s+create\b|\bnpm\s+publish\b|\bbun\s+publish\b|\bsaw\s+repo\s+apply\b|main\.ts\s+repo\s+apply\b/;
// safety.no_secrets: any command naming a .env file (quoted or not; read, copy,
// grep or source alike). Example and template variants are fine.
const SECRETS = /(^|[\s'"=:<\\/])\.env(\.(?!(example|sample|template|dist)\b)[\w.-]+)?(?=['"\s;|&>)]|$)/;

const EXISTS_ONLY = /^(ls|test|\[)( [^;|&<>`$]*)?$/;

// The agent editing its own guardrails: saw config set|unset of a guard key,
// or a shell write to a settings layer. Always the user's call.
const CONFIG_EDIT = /\b(saw|main\.ts)\s+config\s+(set|unset)\s+(\S+\s+)*["']?(safety|autonomy|features)\./;
const SETTINGS_FILE = /(^|[\\/])workflow(\.local)?\.toml$/;
const SETTINGS_WRITE = /(>>?|\btee\b|\bsed\s+-i|\bSet-Content\b|\bAdd-Content\b|\bOut-File\b|\b(cp|mv|Copy-Item|Move-Item)\b)[^;|&]*\bworkflow(\.local)?\.toml\b/;

// Spellings folded to one form before matching, so neither the deny-list nor
// the action patterns can be sidestepped: git's global options (`git -C . push`)
// are dropped; rm's flags in any order ("-fr", "--recursive --force") become
// "rm -rf"; any download piped to a shell becomes "curl | sh".
const normalise = (s: string): string =>
  s.trim().replace(/\s+/g, " ")
    .replace(/\bgit((?: (?:-C \S+|-c \S+|--git-dir(?:=| )\S+|--work-tree(?:=| )\S+|--namespace(?:=| )\S+|--no-pager|-P|--bare|--no-replace-objects|--literal-pathspecs|--no-optional-locks))+)(?= )/g, "git")
    .replace(/\brm((?: -{1,2}[a-zA-Z-]+)+)/g, (m, flags: string) => {
      const f = flags.replace(/--recursive/g, "-r").replace(/--force/g, "-f");
      return /-[a-zA-Z]*[rR]/.test(f) && /-[a-zA-Z]*f/.test(f) ? "rm -rf" : m;
    })
    .replace(/\b(curl|wget|iwr|Invoke-WebRequest)\b[^|;&]*\| ?(sudo )?(ba|z|da)?sh\b/g, "curl | sh");

interface Safety {
  deny?: string[];
  push?: string;
  destructive_approval?: boolean;
  deploy_approval?: boolean;
  no_secrets?: boolean;
}

export function guardCommand(config: Table, command: string): Verdict {
  const cmd = normalise(command);
  const safety = (config.safety ?? {}) as Safety;
  for (const pattern of safety.deny ?? []) {
    if (pattern && cmd.includes(normalise(pattern))) return { decision: "deny", reason: `"${pattern}" is on the safety.deny list` };
  }
  // Existence checks (ls, test -f, [ -f ]) read nothing; anything chained after them still counts.
  if (safety.no_secrets && SECRETS.test(cmd) && !EXISTS_ONLY.test(cmd)) return { decision: "deny", reason: "safety.no_secrets: don't read or copy secrets files in the session" };
  if (CONFIG_EDIT.test(cmd) || SETTINGS_WRITE.test(cmd)) return { decision: "ask", reason: "changing workflow settings that guard the agent needs your approval" };
  const features = (config.features ?? {}) as Record<string, boolean>;
  if (!features.parallel_sessions && SPAWN.test(cmd)) return { decision: "deny", reason: "features.parallel_sessions is off: no new sessions" };
  if (!features.worktrees && WORKTREE.test(cmd)) return { decision: "deny", reason: "features.worktrees is off" };
  const autonomy = (config.autonomy ?? {}) as { level?: string; actions?: Record<string, string> };
  const actions = autonomy.actions ?? {};
  const levels: Record<string, string | undefined> = { ...actions, push: strictest(safety.push, actions.push), spawn_review: actions.spawn_sessions };
  for (const [action, re] of Object.entries(ACTIONS)) {
    if (!re.test(cmd)) continue;
    // suggest: the agent only suggests, so it never takes these actions itself.
    const level = autonomy.level === "suggest" ? "never" : levels[action];
    if (level === "never") return { decision: "deny", reason: `autonomy: ${action} is ${autonomy.level === "suggest" ? "off under autonomy.level = suggest" : "set to never"}` };
    if (level === "ask") return { decision: "ask", reason: `autonomy: ${action} needs your approval` };
  }
  if (safety.destructive_approval && DESTRUCTIVE.test(cmd)) return { decision: "ask", reason: "safety.destructive_approval: destructive command" };
  if (safety.deploy_approval && DEPLOY.test(cmd)) return { decision: "ask", reason: "safety.deploy_approval: deploy or publish command" };
  return undefined;
}

// autonomy.actions.edit_global: file edits under ~/.claude or ~/.saw. Edits to
// a settings layer (workflow.toml, workflow.local.toml) always ask.
export function guardEdit(config: Table, path: string, home = homedir()): Verdict {
  if (SETTINGS_FILE.test(path)) return { decision: "ask", reason: `changing workflow settings needs your approval (${path})` };
  const level = ((config.autonomy ?? {}) as { actions?: Record<string, string> }).actions?.edit_global;
  if (level !== "never" && level !== "ask") return undefined;
  const full = resolvePath(path).toLowerCase();
  const global = [".claude", ".saw"].some((d) => {
    const rel = relative(resolvePath(home, d).toLowerCase(), full);
    return !rel.startsWith("..") && !isAbsolute(rel);
  });
  if (!global) return undefined;
  return { decision: level === "never" ? "deny" : "ask", reason: `autonomy: edit_global is ${level === "never" ? "set to never" : "ask"} (${path})` };
}

function strictest(a?: string, b?: string): string | undefined {
  for (const level of ["never", "ask"]) if (a === level || b === level) return level;
  return a ?? b;
}

// output.rewrite_commands: a Bash call that is exactly a [checks] command runs
// as `saw run <check>` instead, so its output is quiet and the result recorded.
export function rewriteCommand(config: Table, command: string): string | undefined {
  if (!((config.output ?? {}) as { rewrite_commands?: boolean }).rewrite_commands) return undefined;
  const cmd = normalise(command);
  const check = Object.entries((config.checks ?? {}) as Record<string, unknown>).find(([, c]) => typeof c === "string" && c.trim() && normalise(c) === cmd)?.[0];
  if (!check) return undefined;
  const root = process.env.CLAUDE_PLUGIN_ROOT;
  return `${root ? `"${root}/bin/saw"` : "saw"} run ${check}`;
}

// Returns the hook's JSON output, or undefined to let the call through.
export function guardHook(config: Table, input: { tool_name?: string; tool_input?: { command?: unknown; file_path?: unknown } }): Record<string, unknown> | undefined {
  const t = input.tool_input;
  const g = input.tool_name === "Bash" && typeof t?.command === "string"
    ? guardCommand(config, t.command)
    : typeof t?.file_path === "string" && ["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(input.tool_name ?? "")
      ? guardEdit(config, t.file_path)
      : undefined;
  if (!g) {
    const rewritten = input.tool_name === "Bash" && typeof t?.command === "string" ? rewriteCommand(config, t.command) : undefined;
    // No permission decision: the rewritten command still goes through the usual prompt.
    return rewritten ? { hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { ...t, command: rewritten } } } : undefined;
  }
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: g.decision, permissionDecisionReason: `saw guard: ${g.reason}` } };
}
