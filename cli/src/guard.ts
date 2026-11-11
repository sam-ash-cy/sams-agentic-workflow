// `saw guard`: a PreToolUse hook that enforces [safety] and [autonomy]
// mechanically, instead of relying on instructions. "never" denies, "ask"
// hands the decision to the user, anything else allows.

import { homedir } from "node:os";
import { isAbsolute, relative, resolve as resolvePath, sep } from "node:path";
import { branchSettings, currentBranch, onBase, worktreeTask } from "./branch";
import type { Table } from "./defaults";
import { currentTask } from "./task";
import { guardAgent, implementerEdit } from "./model-guard";
import { testsFirstEdit } from "./tests-first";
import { routingEdit } from "./routing-guard";
import { verifyBlock } from "./verify-guard";
import { REVIEW_KEY } from "./review-session";

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

// verify.mode hard holds these until the open task is Verified (verify-guard.ts).
const VERIFIED_ONLY = ["commit", "push", "open_pr"];

// safety.destructive_approval / deploy_approval: always ask, whatever the autonomy level.
const DESTRUCTIVE = /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s)|\bgit\s+branch\s+-D\b|\b(drop|truncate)\s+(table|database)\b|\bmigrate:fresh\b|\bdb:wipe\b/i;
const DEPLOY = /\b(terraform|tofu)\s+(apply|destroy)\b|\bkubectl\s+(apply|delete)\b|\bhelm\s+(install|upgrade|uninstall)\b|\b(fly|flyctl)\s+deploy\b|\bvercel\b.*--prod\b|\bgh\s+release\s+create\b|\bnpm\s+publish\b|\bbun\s+publish\b|\bsaw\s+repo\s+apply\b|main\.ts\s+repo\s+apply\b/;
// safety.no_secrets: any command naming a .env file (quoted or not; read, copy,
// grep or source alike). Example and template variants are fine.
const SECRETS = /(^|[\s'"=:<\\/])\.env(\.(?!(example|sample|template|dist)\b)[\w.-]+)?(?=['"\s;|&>)]|$)/;

const EXISTS_ONLY = /^(ls|test|\[)( [^;|&<>`$]*)?$/;

// The agent editing its own guardrails: saw config set|unset of a guard key,
// or a shell write to a settings layer. Always the user's call.
const CONFIG_EDIT = /\b(saw|main\.ts)\s+config\s+(set|unset)\s+(\S+\s+)*["']?((safety|autonomy|features|routing\.mode)\b|verify\.)/;
const SETTINGS_FILE = /(^|[\\/])workflow(\.local)?\.toml$/;
const SETTINGS_WRITE = /(>>?|\btee\b|\bsed\s+-i|\bSet-Content\b|\bAdd-Content\b|\bOut-File\b|\b(cp|mv|Copy-Item|Move-Item)\b)[^;|&]*\bworkflow(\.local)?\.toml\b/;

// Spellings folded to one form before matching, so neither the deny-list nor
// the action patterns can be sidestepped: git's global options (`git -C . push`)
// are dropped; rm's flags in any order ("-fr", "--recursive --force") become
// "rm -rf"; any download piped to a shell becomes "curl | sh"; a quoted single
// word loses its quotes (`"git" "push"` is git push).
const normalise = (s: string): string =>
  s.trim().replace(/\s+/g, " ")
    .replace(/"([^"\s$`\\]+)"|'([^'\s]+)'/g, (_, d?: string, q?: string) => d ?? q ?? "")
    .replace(/\bgit((?: (?:-C \S+|-c \S+|--git-dir(?:=| )\S+|--work-tree(?:=| )\S+|--namespace(?:=| )\S+|--no-pager|-P|--bare|--no-replace-objects|--literal-pathspecs|--no-optional-locks))+)(?= )/g, "git")
    .replace(/\brm((?: -{1,2}[a-zA-Z-]+)+)/g, (m, flags: string) => {
      const f = flags.replace(/--recursive/g, "-r").replace(/--force/g, "-f");
      return /-[a-zA-Z]*[rR]/.test(f) && /-[a-zA-Z]*f/.test(f) ? "rm -rf" : m;
    })
    .replace(/\b(curl|wget|iwr|Invoke-WebRequest)\b[^|;&]*\| ?(sudo )?(ba|z|da)?sh\b/g, "curl | sh");

// Quoted text that is only data (an echo, a commit message, a prompt) is
// blanked before the deny-list and action patterns run, so mentioning a
// command isn't running it. Only when every command on the line is one that
// treats its quoted arguments as text (DATA_ONLY); a line with anything else
// (a shell, sudo, awk, an interpreter...) is matched as written. A quote
// holding `$(` or a backtick, or holding no space, is never blanked.
// Matched against the line as written: git's global options (`-c core.editor=...`)
// and rg's --pre can run a string, so neither form counts as data-only.
// Read-only commands that never run their arguments (cd, ls, cat, tail...) can
// share the line without making the quoted text live.
const DATA_ONLY = /^(echo|printf|grep|claude|true|cd|ls|cat|head|tail|wc|sort|uniq|cut|git (commit|tag|log|notes)|gh (pr|issue) (create|comment|edit|close|review))\b/;
const QUOTED = /"((?:[^"\\]|\\.)*)"|'([^']*)'/g;
// A heredoc with a quoted delimiter expands nothing, and fed to cat or tee its
// body is only written out, so it is data too (not when piped or chained on).
const DATA_HEREDOC = /^(\s*(?:cat|tee(?: -a)?)\b[^\n|;&`$]*<<-?\s*(['"])(\w+)\2[^\n|;&`$]*\n)[\s\S]*?\n\3[ \t]*$/gm;

export function blankQuotedData(cmd: string): string {
  cmd = cmd.replace(DATA_HEREDOC, (_, head: string, _q: string, tag: string) => `${head}${tag}`);
  const outside = cmd.replace(QUOTED, "Q");
  if (/[`$<>]\(|`|\$\(/.test(outside)) return cmd;
  const segments = outside.split(/\s*(?:\|\|?|&&?|;|\n)\s*/).filter((s) => s.trim());
  if (!segments.every((s) => DATA_ONLY.test(s.trim().replace(/\s+/g, " ")))) return cmd;
  return cmd.replace(QUOTED, (m, dq: string | undefined, sq: string | undefined) => {
    const body = dq ?? sq ?? "";
    if (!/\s/.test(body) || /\$\(|`/.test(body)) return m;
    return '""';
  });
}

// A settings file is this project's when it sits in the working directory, one
// of its ancestors (a parent layer) or below it. Anything else (another repo, a
// sandbox under the temp dir) isn't a layer the agent here runs under.
// On Windows a Git Bash drive path (/c/...) is read as the C: drive.
export function isProjectSettings(path: string, cwd = process.cwd()): boolean {
  // A variable or a home shortcut can't be resolved here, so it counts. A `~`
  // inside a path is a Windows short name (RUNNER~1), not home.
  if (/[$%`]|^~/.test(path)) return true;
  const win = process.platform === "win32";
  const fold = (s: string): string => win ? s.toLowerCase() : s;
  const dir = fold(resolvePath(cwd, win ? path.replace(/^\/([a-zA-Z])(?=\/)/, "$1:") : path, ".."));
  const here = fold(resolvePath(cwd));
  const inside = (a: string, b: string): boolean => {
    const rel = relative(a, b);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  };
  return inside(dir, here) || inside(here, dir);
}

const SETTINGS_PATHS = /"([^"]*workflow(?:\.local)?\.toml)"|'([^']*workflow(?:\.local)?\.toml)'|([^\s"'<>|;&]*workflow(?:\.local)?\.toml)/g;

function writesProjectSettings(cmd: string, cwd: string): boolean {
  if (!SETTINGS_WRITE.test(cmd)) return false;
  // A copy or move can land a settings file here under a destination that names no file.
  if (/\b(cp|mv|Copy-Item|Move-Item|ln|rsync|install)\b/.test(cmd)) return true;
  const paths = [...cmd.matchAll(SETTINGS_PATHS)].map((m) => m[1] ?? m[2] ?? m[3]);
  return paths.length === 0 || paths.some((p) => isProjectSettings(p, cwd));
}

interface Safety {
  deny?: string[];
  push?: string;
  destructive_approval?: boolean;
  deploy_approval?: boolean;
  no_secrets?: boolean;
}

export function guardCommand(config: Table, command: string, cwd = process.cwd()): Verdict {
  const full = normalise(command);
  // Secrets and settings checks see the whole line: a quoted path is still a path.
  const cmd = normalise(blankQuotedData(command));
  const safety = (config.safety ?? {}) as Safety;
  for (const pattern of safety.deny ?? []) {
    if (pattern && cmd.includes(normalise(pattern))) return { decision: "deny", reason: `"${pattern}" is on the safety.deny list` };
  }
  // Existence checks (ls, test -f, [ -f ]) read nothing; anything chained after them still counts.
  if (safety.no_secrets && SECRETS.test(full) && !EXISTS_ONLY.test(full)) return { decision: "deny", reason: "safety.no_secrets: don't read or copy secrets files in the session" };
  if (CONFIG_EDIT.test(full) || writesProjectSettings(full, cwd)) return { decision: "ask", reason: "changing workflow settings that guard the agent needs your approval" };
  const features = (config.features ?? {}) as Record<string, boolean>;
  if (!features.parallel_sessions && SPAWN.test(cmd)) return { decision: "deny", reason: "features.parallel_sessions is off: no new sessions" };
  if (!features.worktrees && WORKTREE.test(cmd)) return { decision: "deny", reason: "features.worktrees is off" };
  const autonomy = (config.autonomy ?? {}) as { level?: string; actions?: Record<string, string> };
  const actions = autonomy.actions ?? {};
  const levels: Record<string, string | undefined> = { ...actions, push: strictest(safety.push, actions.push), spawn_review: actions.spawn_sessions };
  // verify.mode hard: nothing leaves the machine (or lands in history) from an unverified task.
  if (VERIFIED_ONLY.some((a) => ACTIONS[a]!.test(cmd))) {
    const block = verifyBlock(config, cwd);
    if (block) return block;
  }
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

// Folders under ~/.claude that Claude Code itself tells the agent to write: the
// plan-mode plan file and the per-project auto memory. Blocking them breaks plan
// mode and memory, and they hold no settings, hooks or instructions. Fixed here,
// not a setting, so no settings layer can widen it.
const CLAUDE_CODE_OWNED = [/^plans[\\/][^\\/]+\.md$/, /^projects[\\/][^\\/]+[\\/]memory[\\/][^\\/]+\.md$/];

// autonomy.actions.edit_global: file edits under ~/.claude or ~/.saw, except
// CLAUDE_CODE_OWNED. Edits to a settings layer (workflow.toml,
// workflow.local.toml) always ask.
export function guardEdit(config: Table, path: string, home = homedir(), cwd = process.cwd()): Verdict {
  if (SETTINGS_FILE.test(path) && isProjectSettings(path, cwd)) return { decision: "ask", reason: `changing workflow settings needs your approval (${path})` };
  const level = ((config.autonomy ?? {}) as { actions?: Record<string, string> }).actions?.edit_global;
  if (level !== "never" && level !== "ask") return undefined;
  const full = resolvePath(path).toLowerCase();
  const global = [".claude", ".saw"].some((d) => {
    const rel = relative(resolvePath(home, d).toLowerCase(), full);
    if (rel.startsWith("..") || isAbsolute(rel)) return false;
    return !(d === ".claude" && CLAUDE_CODE_OWNED.some((re) => re.test(rel)));
  });
  if (!global) return undefined;
  return { decision: level === "never" ? "deny" : "ask", reason: `autonomy: edit_global is ${level === "never" ? "set to never" : "ask"} (${path})` };
}

// The file an edit tool touches (NotebookEdit names it notebook_path).
const editTarget = (t?: { file_path?: unknown; notebook_path?: unknown }): string | undefined =>
  typeof t?.file_path === "string" ? t.file_path : typeof t?.notebook_path === "string" ? t.notebook_path : undefined;

const strictestVerdict = (a: Verdict, b: Verdict): Verdict => a?.decision === "deny" ? a : b?.decision === "deny" ? b : a ?? b;

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
// ~/.saw/review-key signs saw's own review records (verify.require_review_evidence
// = review_session). Any tool call that names it, or globs inside a .saw folder
// from the shell (cat ~/.saw/r*), is denied whatever the settings say: an agent
// holding the key could sign a review that never ran.
const REVIEW_KEY_ACCESS = [new RegExp(REVIEW_KEY), /\.saw[\\/]+\S*[*?[]/];

export function reviewKeyAccess(toolInput: unknown): boolean {
  const text = typeof toolInput === "object" && toolInput ? Object.values(toolInput).filter((v) => typeof v === "string").join("\n") : "";
  return REVIEW_KEY_ACCESS.some((re) => re.test(text));
}

const REVIEW_KEY_DENY = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "saw guard: ~/.saw/review-key signs saw's review records; no tool may read, list or change it" } };

// Read-only tools only need the review-key check, which needs no settings: the
// guard answers them before reading any settings file, so a broken file can't
// block reading and the check stays cheap on every Read, Grep and Glob.
export const READ_ONLY_TOOLS = ["Read", "Grep", "Glob", "LS", "NotebookRead"];

// null: not a read-only call, run the full guard.
export function readOnlyGuard(input: { tool_name?: string; tool_input?: unknown }): Record<string, unknown> | undefined | null {
  if (!READ_ONLY_TOOLS.includes(input.tool_name ?? "")) return null;
  return reviewKeyAccess(input.tool_input) ? REVIEW_KEY_DENY : undefined;
}

// Settings that can't be parsed: one typo must not lock the session. Calls that
// change something ask (so the file can still be fixed, and saw doctor run);
// anything else, subagents included, goes through. The review key stays denied.
export function unreadableSettingsGuard(input: { tool_name?: string; tool_input?: unknown }, problem: string): Record<string, unknown> | undefined {
  if (reviewKeyAccess(input.tool_input)) return REVIEW_KEY_DENY;
  if (!["", "Bash", "Edit", "Write", "MultiEdit", "NotebookEdit"].includes(input.tool_name ?? "")) return undefined;
  return { systemMessage: `saw guard: ${problem}`, hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: `saw guard: ${problem}; approve this call, or fix the file first` } };
}

export function guardHook(config: Table, input: { tool_name?: string; session_id?: string; agent_id?: unknown; tool_input?: { command?: unknown; file_path?: unknown; notebook_path?: unknown; subagent_type?: unknown; model?: unknown } }, cwd = process.cwd()): Record<string, unknown> | undefined {
  const t = input.tool_input;
  if (reviewKeyAccess(t)) {
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "saw guard: ~/.saw/review-key signs saw's review records; no tool may read, list or change it" } };
  }
  const edit = ["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(input.tool_name ?? "");
  const wrongModel = ["Agent", "Task"].includes(input.tool_name ?? "") && t ? guardAgent(config, t) : undefined;
  const g: Verdict = input.tool_name === "Bash" && typeof t?.command === "string"
    ? guardCommand(config, t.command, cwd)
    : wrongModel
      ? { decision: "deny", reason: wrongModel }
      : edit
        ? strictestVerdict(strictestVerdict(strictestVerdict(typeof t?.file_path === "string" ? guardEdit(config, t.file_path, homedir(), cwd) : undefined, implementerEdit(config, input, cwd)), testsFirstEdit(config, editTarget(t), cwd)), routingEdit(config, editTarget(t), cwd, input.session_id))
        : undefined;
  const target = typeof t?.file_path === "string" ? t.file_path : typeof t?.notebook_path === "string" ? t.notebook_path : undefined;
  const g2 = g ?? baseBranchGuard(config, input.tool_name ?? "", typeof t?.command === "string" ? t.command : "", cwd, undefined, target);
  if (!g2) {
    const rewritten = input.tool_name === "Bash" && typeof t?.command === "string" ? rewriteCommand(config, t.command) : undefined;
    // No permission decision: the rewritten command still goes through the usual prompt.
    return rewritten ? { hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { ...t, command: rewritten } } } : undefined;
  }
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: g2.decision, permissionDecisionReason: `saw guard: ${g2.reason}` } };
}

// Also inside a quoted `bash -c "git commit ..."`.
const COMMIT = /(?:^|[;&|\n("'`]\s*)git\s+(?:(?:-[Cc]\s+\S+|--[\w-]+(?:=\S+)?)\s+)*commit\b/;

// features.branch_guard: no commit on [branch].base, and no edit there while a
// non-trivial task is open. Asks git only for those calls.
export function baseBranchGuard(config: Table, tool: string, command: string, cwd: string, branch?: (cwd: string) => string, filePath?: string): Verdict {
  const s = branchSettings(config);
  if (!s.enabled) return undefined;
  const edit = ["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool);
  const commit = tool === "Bash" && COMMIT.test(command);
  if (!edit && !commit) return undefined;
  if (edit) {
    // Only files in this repo: plan files and memory under ~/.claude stay writable.
    const rel = relative(resolvePath(cwd), resolvePath(cwd, filePath ?? ""));
    if (!filePath || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
    const task = currentTask(cwd);
    const away = !task ? worktreeTask(cwd) : undefined;
    if (away) {
      const current = (branch ?? currentBranch)(cwd);
      if (current && onBase(current, s.base)) return { decision: "deny", reason: `features.branch_guard: the task is open in worktree ${away.path} (${away.name}); edit the files there, not on ${current}` };
      return undefined;
    }
    if (!task || task.tier === "trivial") return undefined;
  }
  const current = (branch ?? currentBranch)(cwd);
  if (!current || !onBase(current, s.base)) return undefined;
  return { decision: "deny", reason: `features.branch_guard: on ${current}; branch off ${s.base} first (saw task start --branch <type>/<kebab>, or git switch -c <type>/<kebab>)` };
}
