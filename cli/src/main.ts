// saw: the sams-agentic-workflow CLI.

import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { baseBranch, flatten, inside, layerPaths, layerValues, loosens, parseValue, resolve, setPath, unsetPath, validate, weakenedSafety, writeSetting, type Layer } from "./config";
import { DEFAULTS, type Table, type Value } from "./defaults";
import { readIfExists } from "./fs";
import { syncAgents, syncSession } from "./agents";
import { resume, resumeHint, writeCard } from "./resume";
import { syncCompact } from "./autocompact";
import { AGENTS, checkAdapters, installAdapters } from "./adapters";
import { syncVault, vaultPath } from "./vault";
import { budgetHook, contextHook, routerNudge } from "./context";
import { planModelWarning } from "./model-guard";
import { applyBranch, branchSettings, currentBranch, markWorktreeTask, planBranch } from "./branch";
import { guardHook, readOnlyGuard, unreadableSettingsGuard } from "./guard";
import { sessionHook, UNITS } from "./sessions";
import { recordReview, reviewApplies, reviewArgv, reviewBrief, writeChange, type ReviewSettings } from "./review-session";
import { effectiveStyle, styleCheck, styleLine, TONES } from "./style";
import { autoApproveTiers, autopilot, parseQueue, planQueue, readRuns, readState as autopilotState, scheduleCommand, settings as autopilotSettings, spawnClaude, stopReasons } from "./autopilot";
import { plan } from "./plan";
import { renderHtml, renderMarkdown } from "./dashboard";
import { dashboardUrl, serveDashboard } from "./dashboard-server";
import { hookCwd } from "./hook-cwd";
import { logEvent, readEvents } from "./events";
import { adoption, featureUsage, formatAdoption, formatFeatureUsage } from "./adoption";
import { appendMetric, buildMetric, readMetrics } from "./metrics";
import { compare, formatAb, runAb, summarise, type Comparison, type EvalRunner, type Summary } from "./evals";
import { failureCandidates } from "./failures";
import { configSuggestions, readProposals, retro } from "./retro";
import { companionWarnings, compareUrl, pin, readLock, readSyncedPluginNames, verifyLock } from "./deps";
import { initProject, uninstall, upgrade, workspaceRepos, type ChangeReport, type InitReport } from "./init";
import { lintContext, lintMemory } from "./lint";
import { docsNudge, docsStatus, REFRESH_BRIEF } from "./docs";
import { outline } from "./outline";
import { checkVersions, commitsSince, notesFor, release, tagRelease, verifyTag } from "./release";
import { prBody, SAFE_REF } from "./pr-body";
import { applySplit, parseSplit, planSplit } from "./split";
import { sanitize, sanitizeHistory } from "./sanitize";
import { syncAdvisor, syncSkillDenies } from "./skills";
import { applyPlan, gh, readState, repoName, repoPlan, type Gh } from "./repo";
import { formatHook, runCheck, TRUSTED_LAYERS } from "./run";
import { checkMods, DEFAULT_MODS, listMods } from "./mods";
import { addProject, inspectProject, listProjects, registerProject, removeProject } from "./projects";
import { verifyMode } from "./verify-guard";
import { acceptanceLine, acceptanceProblem, addAcceptance, currentTask, endTask, gate, gitStatusHash, isSawProject, markUntaskedEdit, noteUnverifiedExit, noChecksWarning, pickTier, recordCheck, recordVerifiedTree, retierTask, reviewEvidence, statusProblems, setPhase, staleMessage, staleTask, startTask, storedTreeHash, storeTreeHash, takeUnverifiedExit, taskReport, writeStatusFile, taskStatus, taskSkills, taskSteps, type Status, editOpensProvisional, openProvisional } from "./task";
import { routingMode } from "./routing-guard";
import { subagentHook } from "./subagent";
import { patchToml, readToml, stringifyToml } from "./toml";
import { applyProfile, parseProfiles } from "./profiles";
import { aboutHook, aboutPaths, createAbout, type AboutScope } from "./about-me";
import { catalog, changedFiles, figmaFallback, findSkills, installedNames, installSteps, isInstalled, missingSkillPlugins, offer, readState as readRecommendState, recommendHook, writeState } from "./recommend";

const USAGE = `usage: saw <command>
  config show [--resolved] [--layers [--json]]   resolved settings (with the layer each came from); --layers: every key in every layer
  docs status [--json] | refresh     which project docs are still the blank template; refresh prints the fill-from-code brief
  config get <key>
  config set <key> <value> [--scope global|project|local]   (default: project)
  config unset <key> [--scope ...]
  explain <key>                      the value in every layer, which one won, and why one was ignored
  profile list | show <name> | apply <name> [--dry-run]   merge a recommended profile (docs/COMMANDS.md) into the layers it names
  projects list | add <path> [--setup] | remove <path>   the projects saw knows about (~/.saw/projects.json); add scans the folder; remove only forgets it
  doctor [--hooks] [--no-plugin]    check settings, environment and the Claude Code plugin install (--hooks: time each plugin hook once, in ms)
  init [--dry-run] [--force] [--type <t>] [--hooks] [--agents a,b] [--repo [o/n]]   add workflow.toml, AGENTS.md, CI and the docs/ vault (+ agent adapters; --repo: show the repo plan)
  init --workspace <dir> [--apply]   init every git repo directly under <dir> that has no workflow.toml (dry run unless --apply)
  init --upgrade [--dry-run]         update unedited template files to the current template; edited ones are kept
  uninstall [--dry-run]              remove template files you haven't edited
  agents check                       smoke test: will each agent in agents.enabled read AGENTS.md?
  vault sync [--dry-run]             index this project (and its learnings) in the central vault
  sync [--plugin-dir <dir>] [--scope global] [--dry-run]   write .saw/resolved.json; set agent models from [models]; deny skills of disabled features; [context] autocompact (--scope global: the global layer into ~/.claude/settings.json)
  deps list | verify [--strict]      pinned third-party skills (deps.lock.toml)
  deps diff <name> <sha>             compare URL to review before updating a pin
  deps pin <name> <sha> --reviewed-by <who>
  task start --tier <t> --playbook <p> [--tone <t>] [--max-words <n>] [--unit phase|stage|feature --unit-id <name>] [--accept "<criterion>"]...   open a task (the router does this); --accept, repeatable: acceptance criteria, numbered from 1
  task accept add "<criterion>"     add an acceptance criterion to the open task
  task adhoc [--playbook <p>]        open a trivial task for a one-off edit (same as task start --tier trivial)
  task phase plan|implement|review  mark where the open task is (implement: the main session can't edit source when features.implementer is on)
  task status                        report label + which required checks passed, failed or are missing
  task record <check> pass|fail [--note "..."] [--report <file>]   record a judgement check (code_review, ...); --report: a reviewer's report under .saw/reviews/ (verify.require_review_evidence)
  task record accept:<n> pass|fail --note "<how it was shown>"   record acceptance criterion <n> (a pass needs --note); the task isn't Verified until every criterion passes
  task report [--post [--pr <n>] [--yes]]   Markdown verification section for a PR (--post: gh pr comment, per autonomy.actions.open_pr)
  task pr-body [--base <ref>]   PR description: commits since <ref> (default origin/<branch.base>) and the verification section
  repo plan|apply [--repo o/n] [--yes]   GitHub settings from [repo]: diff, then apply only with --yes and re-verify
  outline <file>                     signatures with line numbers (when Trail is off)
  task retier <tier>                 change the open task's tier (keeps its checks; never below what the diff needs)
  task end [--tokens <n>] [--reason "<why>"]   close the task and append its metrics (.saw/metrics.jsonl); --reason is required unless it is Verified
  dashboard [--serve [--port <n>]]   write the static metrics page (and the Obsidian note if set); --serve: live page on 127.0.0.1
  adoption [--features] [--since <days>] [--json] is the workflow used? (--features: trigger count per feature and mod) tasks opened vs Stops, denials, unverified exits, tiers
  retro [--dry-run]                  write a proposal for each check failing in repeat_threshold+ tasks
  eval [--case <glob>] [--runs <n>] [--dry-run] [--save-baseline] [--ab]   run the eval suite (claude plugin eval) and compare with the baseline; --ab runs it with saw on and off (.saw/evals-ab.json)
  eval compare <before.json> <after.json>  compare two saved eval results
  mods check [<name>]                validate and test the mods under mods/ (needs the claude CLI)
  run <check> [--changed]            run checks.<check> quietly and record the result (--changed: only tests for changed files)
  resume                             restore the task, branch and plan a stopped session left in .saw/handoff.json
  gate                               Stop hook: block "done" until the tier's checks pass
  lint-context                       AGENTS.md / CLAUDE.md size limits
  memory lint                        stale file refs in docs/learnings and docs/decisions, duplicate learnings, size limits
  release [patch|minor|major|<x.y.z>] [--pre <id>] [--dry-run] [--all] [--allow-branch]   (on main; release.flow=release-branch: release/vX.Y.Z or hotfix/*)
                                     bump every manifest, write CHANGELOG.md and commit (never pushes; tag on main after the merge)
  release tag [--dry-run] [--allow-branch]   on main after the release merge: annotated vX.Y.Z tag from CHANGELOG.md (never pushes)
  split <plan.md> [--dry-run]        one worktree + branch per step heading that names a branch ("feat/x" in backticks), its brief in .saw/brief.md
  release notes <tag> | verify <tag> one version's changelog section; check a tag matches every manifest (CI)
  sanitize [--history]               before going public: secrets, home paths, emails and your own names in published files (--history: in every commit)
  context                            UserPromptSubmit hook: suggest /compact as context fills; warn on the task's token budget
  guard                              PreToolUse hook: enforce [safety] and [autonomy] on shell commands and file edits, models.roles on saw agent calls
  session-start                      SessionStart hook: warn when the session's model isn't models.roles.plan
  format-hook                        PostToolUse hook: run checks.format after each edit
  review-session brief|run [--dry-run]|record <file> --unit <kind> --unit-id <name>   independent read-only review of a unit ([review_session])
  autopilot [status] [--dry-run] [--once] [--install-schedule]   work through approved queue items, one headless session + branch each ([autopilot]; never merges)
  plan "<goal>" [--dry-run]          one headless planning session: ADR drafts, roadmap and [proposed] queue items, then validates the queue ([plan])
  style                              the effective reply style for this task (tone, word cap)
  style-check                        Stop hook: warn (soft) or ask for a rewrite (hard) when a reply is over the cap
  about-me [show] [--scope global|project|local] [--dry-run]   create the about-me profile from the template (show: the merged summary sessions get)
  recommend list | add <id> [--scope global|project|local] [--dry-run] | dismiss <id>   suggested MCP servers and skills (recommendations.toml)
  skills find                        skills that fit the open task's changes (what saw task end suggests)
global flag: --set key=value         per-task override (repeatable)`;

interface Args {
  positional: string[];
  flags: Set<string>;
  scope: Exclude<Layer, "default" | "override" | `enforcement=${string}`>;
  // Whether --scope was given (saw recommend add then passes it on).
  scoped: boolean;
  overrides: Record<string, Value>;
  values: Record<string, string>;
  // --accept "<criterion>", repeatable (saw task start).
  accepts: string[];
}

const VALUE_FLAGS = ["--runs", "--repo", "--pr", "--tier", "--playbook", "--note", "--plugin-dir", "--reviewed-by", "--type", "--tokens", "--case", "--agents", "--tone", "--max-words", "--unit", "--unit-id", "--port", "--report", "--pre", "--base", "--reason", "--since", "--workspace"];
const PLUGIN_ROOT = join(import.meta.dir, "..", "..");

function parseArgs(argv: string[]): Args {
  const args: Args = { positional: [], flags: new Set(), scope: "project", scoped: false, overrides: {}, values: {}, accepts: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--scope") {
      args.scope = argv[++i] as Args["scope"];
      args.scoped = true;
    }
    else if (a === "--set") {
      const [key, ...rest] = (argv[++i] ?? "").split("=");
      args.overrides[key!] = parseValue(rest.join("="));
    } else if (a === "--accept") {
      // Bare --accept doesn't swallow the next flag; the empty criterion is refused by startTask.
      const next = argv[i + 1];
      args.accepts.push(next !== undefined && !next.startsWith("--") ? argv[++i]! : "");
    }
    else if (VALUE_FLAGS.includes(a)) {
      // A value flag given bare (saw init --repo) doesn't swallow the next flag.
      const next = argv[i + 1];
      args.values[a.slice(2)] = next !== undefined && !next.startsWith("--") ? argv[++i]! : "";
    }
    else if (a.startsWith("--")) args.flags.add(a);
    else args.positional.push(a);
  }
  return args;
}

function printReport(report: InitReport, dryRun: boolean): void {
  const head = dryRun ? "dry run, nothing written" : "done";
  console.log(`saw init: ${head}`);
  for (const [label, items] of [["installed", report.installed], ["changed", report.changed], ["backed up", report.backedUp], ["skipped", report.skipped]] as const) {
    for (const item of items) console.log(`  ${label.padEnd(9)} ${item}`);
  }
}

export function repoCommand(config: Table, sub: "plan" | "apply", args: Args, run: Gh = gh): number {
  const c = config.repo as { enabled: boolean; protect: { branch: string } };
  if (!c.enabled) return fail("repo.enabled is false; set it in workflow.toml to manage GitHub settings");
  try {
    const name = repoName(run, args.values.repo);
    const changes = repoPlan(config, name, readState(run, name, c.protect.branch));
    console.log(`saw repo plan: ${name}, ${changes.length} change(s)`);
    for (const ch of changes) console.log(`  ${ch.what.padEnd(28)} ${ch.from} -> ${ch.to}`);
    if (sub === "plan" || !changes.length) return 0;
    // Always the user's call, at every autonomy level.
    if (!args.flags.has("--yes")) return fail("review the plan above, then re-run saw repo apply --yes");
    const r = applyPlan(run, changes);
    for (const a of r.applied) console.log(`  applied ${a}`);
    for (const s of r.skipped) console.log(`  skipped ${s}`);
    for (const f of r.failed) console.error(`  failed  ${f}`);
    const left = repoPlan(config, name, readState(run, name, c.protect.branch)).filter((ch) => !r.skipped.some((s) => s.startsWith(ch.what)));
    for (const ch of left) console.error(`  not applied: ${ch.what} is still ${ch.from}`);
    console.log(r.failed.length || left.length ? "saw repo apply: incomplete" : "saw repo apply: done, verified");
    return r.failed.length || left.length ? 1 : 0;
  } catch (e) {
    return fail((e as Error).message);
  }
}

// saw init --repo: what saw repo apply would change, read-only whatever
// repo.enabled says. A failure (no gh, no remote) is a note, not an init failure.
export function initRepoPlan(cwd: string, args: Args, run: Gh = gh): number {
  const config = resolve(cwd, args.overrides).config;
  const code = repoCommand({ ...config, repo: { ...(config.repo as Table), enabled: true } }, "plan", args, run);
  console.log(code === 0 ? "  to apply: set repo.enabled = true, review, then saw repo apply --yes" : "  (repo plan skipped)");
  return code;
}

function printChanges(head: string, doneLabel: string, keptLabel: string, r: ChangeReport, dryRun: boolean): number {
  console.log(`${head}: ${dryRun ? "dry run, nothing written" : "done"}`);
  for (const f of r.done) console.log(`  ${doneLabel.padEnd(13)} ${f}`);
  for (const f of r.kept) console.log(`  ${keptLabel.padEnd(13)} ${f}`);
  return 0;
}

const HOOKS = ["guard", "gate", "context", "format-hook", "session-hook", "style-check", "failure-hook", "session-start", "subagent-hook"];

// Hook payloads arrive on stdin. In-process callers (the test suite) set a fixed
// payload instead: reading fd 0 there waits forever when the runner's stdin is a
// terminal or a pipe nobody closes.
let stdinOverride: string | undefined;
export const useStdin = (text: string | undefined): void => {
  stdinOverride = text;
};
const readStdin = (): string => stdinOverride ?? readFileSync(0, "utf8");

export function run(argv: string[], cwdArg?: string): number {
  let cwd = cwdArg ?? process.cwd();
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    return fail(`bad --set value: ${(e as Error).message}`);
  }
  const [command, sub, key, raw] = args.positional;
  // Before anything runs: `saw eval --help` must not start a (paid) eval run.
  if (args.flags.has("--help") || args.flags.has("-h")) {
    console.log(USAGE);
    return 0;
  }
  // A hook started with no folder given works where the session does: in a git worktree that is
  // the payload's cwd, not the folder Claude Code was launched from (see hook-cwd.ts). The payload
  // is read once here; the commands below read it back from stdinOverride.
  if (cwdArg === undefined && HOOKS.includes(command ?? "") && (stdinOverride !== undefined || !process.stdin.isTTY)) {
    const text = readStdin();
    stdinOverride = text;
    cwd = hookCwd(text, cwd);
  }
  // The guard reads its payload once, here: read-only tools are answered
  // before any settings file is read (see readOnlyGuard).
  let guardInput: { tool_name?: string; tool_input?: unknown } = {};
  if (command === "guard") {
    try {
      guardInput = JSON.parse(readStdin() || "{}");
    } catch {
      // No payload: nothing to check; unreadable settings still ask below.
    }
    const fast = readOnlyGuard(guardInput);
    if (fast !== null) {
      if (fast) console.log(JSON.stringify(fast));
      return 0;
    }
  }
  let resolved: ReturnType<typeof resolve>;
  try {
    resolved = resolve(cwd, args.overrides);
  } catch (e) {
    const problem = `settings unreadable (${(e as Error).message}); fix the TOML file`;
    if (!HOOKS.includes(command ?? "")) return fail(problem);
    // Fail safe, not shut: changes ask, everything else goes through (unreadableSettingsGuard).
    if (command === "guard") {
      const out = unreadableSettingsGuard(guardInput, problem);
      if (out) console.log(JSON.stringify(out));
    } else {
      // stderr from a hook that exits 0 reaches no one: tell the user, and the
      // agent where the event allows it, so a broken file isn't silently ignored.
      const message = `saw ${command}: ${problem}; this hook is not running`;
      const context = command === "context" ? { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: `[saw] ${message}` } } : {};
      console.log(JSON.stringify({ systemMessage: message, ...context }));
    }
    // Logged with default settings, since the project's can't be read.
    logEvent(cwd, DEFAULTS, "warn", "hook.error", `saw ${command}: ${problem}`);
    return 0;
  }
  for (const w of resolved.warnings) console.error(`warning: ${w}`);

  if (command === "config" && sub === "show" && args.flags.has("--layers")) {
    const rows = layerValues(cwd, resolved);
    if (args.flags.has("--json")) console.log(JSON.stringify(rows, null, 2));
    else for (const r of rows) console.log(`${r.key} = ${JSON.stringify(r.value)}  # ${r.source}  (global ${JSON.stringify(r.global ?? null)}, project ${JSON.stringify(r.project ?? null)}, local ${JSON.stringify(r.local ?? null)})`);
    return 0;
  }
  if (command === "docs" && (sub === "status" || sub === "refresh")) {
    if (sub === "refresh") {
      console.log(REFRESH_BRIEF);
      return 0;
    }
    const status = docsStatus(cwd);
    if (args.flags.has("--json")) console.log(JSON.stringify(status, null, 2));
    else {
      for (const d of status.docs) console.log(`${d.state.padEnd(7)} ${d.path}`);
      const blank = status.docs.filter((d) => d.state === "blank").length;
      console.log(blank && status.hasCode ? `${blank} blank doc(s) in a project with code: run saw docs refresh` : "docs: ok");
    }
    return 0;
  }
  if (command === "config" && sub === "show") {
    const flat = flatten(resolved.config);
    for (const [k, v] of Object.entries(flat)) {
      if (args.flags.has("--resolved") || resolved.sources[k] !== "default") {
        console.log(`${k} = ${JSON.stringify(v)}  # ${resolved.sources[k]}`);
      }
    }
    return 0;
  }
  if (command === "config" && sub === "get" && key) {
    const flat = flatten(resolved.config);
    if (key in flat) {
      console.log(JSON.stringify(flat[key]));
      return 0;
    }
    // A table: every key under it.
    const under = Object.keys(flat).filter((k) => k.startsWith(`${key}.`));
    if (!under.length) return fail(`unknown key "${key}"`);
    for (const k of under) console.log(`${k} = ${JSON.stringify(flat[k])}`);
    return 0;
  }
  if (command === "config" && (sub === "set" || sub === "unset") && key) {
    const path = layerPaths(cwd)[args.scope];
    if (!path) return fail(`--scope must be global, project or local`);
    let value: Value | undefined;
    if (sub === "set") {
      if (raw === undefined) return fail(USAGE);
      try {
        value = parseValue(raw);
      } catch (e) {
        return fail(`bad value for ${key}: ${(e as Error).message}`);
      }
    }
    const written = writeSetting(path, args.scope, key, value);
    if (!written.ok) return fail(written.problem!);
    if (written.warning) console.error(`warning: ${written.warning}`);
    console.log(`${sub === "set" ? "set" : "unset"} ${key} in ${path}`);
    return 0;
  }
  if (command === "explain" && sub) {
    // Every layer's value for one key, and which one won (or why one was ignored).
    const paths = layerPaths(cwd);
    const final = flatten(resolved.config);
    if (!(sub in final)) return fail(`unknown key "${sub}"`);
    console.log(`${sub} = ${JSON.stringify(final[sub])}  (from ${resolved.sources[sub]})`);
    console.log(`  default  ${JSON.stringify(flatten(DEFAULTS)[sub] ?? null)}`);
    for (const layer of ["global", "project", "local"] as const) {
      const value = flatten(readToml(paths[layer]) ?? {})[sub];
      console.log(`  ${layer.padEnd(8)} ${value === undefined ? "-" : JSON.stringify(value)}  ${paths[layer]}`);
    }
    if (sub in args.overrides) console.log(`  override ${JSON.stringify(args.overrides[sub])}  (--set)`);
    for (const w of resolved.warnings.filter((w) => w.includes(sub))) console.log(`  note: ${w}`);
    return 0;
  }
  if (command === "profile") {
    const profiles = parseProfiles(readFileSync(join(PLUGIN_ROOT, "docs", "COMMANDS.md"), "utf8"));
    if (!sub || sub === "list") {
      for (const p of profiles) console.log(`  ${p.name.padEnd(10)} ${p.title}  (${p.blocks.map((b) => b.layer).join(" + ")})`);
      return 0;
    }
    const profile = profiles.find((p) => p.name === key);
    if ((sub !== "show" && sub !== "apply") || !profile) return fail(`usage: saw profile list | show <name> | apply <name> [--dry-run]; names: ${profiles.map((p) => p.name).join(", ")}`);
    if (sub === "show") {
      for (const b of profile.blocks) {
        console.log(`${b.layer} (${layerPaths(cwd)[b.layer]}):`);
        for (const [k, v] of Object.entries(b.values)) console.log(`  ${k} = ${JSON.stringify(v)}`);
      }
      return 0;
    }
    const dryRun = args.flags.has("--dry-run");
    let problems = 0;
    for (const r of applyProfile(cwd, profile, dryRun)) {
      console.log(`${r.layer}: ${r.path}${dryRun ? " (dry run)" : ""}`);
      for (const s of r.set) console.log(`  set ${s}`);
      for (const p of r.problems) console.error(`  skipped: ${p}`);
      problems += r.problems.length;
    }
    console.log(`saw profile apply ${profile.name}: ${dryRun ? "dry run, nothing written" : "done"}; then run saw doctor`);
    return problems ? 1 : 0;
  }
  if (command === "doctor") {
    const weakened = weakenedSafety(resolved);
    for (const w of weakened) console.log(`weakened guardrail: ${w}`);
    const lint = lintContext(cwd, resolved.config);
    const problems = [...resolved.warnings, ...lint];
    for (const p of lint) console.error(`warning: ${p}`);
    if (!args.flags.has("--no-plugin") && process.env.SAW_NO_PLUGIN !== "1") problems.push(...checkPlugin(resolved.config));
    const noChecks = isSawProject(cwd) ? noChecksWarning(resolved.config) : undefined;
    if (noChecks) console.error(`warning: ${noChecks}`);
    if (args.flags.has("--hooks")) problems.push(...checkHooks(cwd));
    const drift = checkVersions(PLUGIN_ROOT);
    for (const d of drift) console.error(`problem: version drift: ${d}`);
    problems.push(...drift);
    const ok = problems.length === 0;
    console.log(ok ? "saw doctor: ok" : `saw doctor: ${problems.length} problem(s)`);
    return ok ? 0 : 1;
  }
  if (command === "init" && args.values.workspace !== undefined) {
    // Every repo directly under <dir> without workflow.toml gets the normal init.
    // Dry run unless --apply; each repo is initialised in its own directory.
    const dir = resolvePath(cwd, args.values.workspace);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return fail(`--workspace: ${dir} is not a directory`);
    const apply = args.flags.has("--apply");
    const { todo, skipped } = workspaceRepos(dir);
    console.log(`saw init --workspace ${dir}: ${todo.length} repo(s) to set up${apply ? "" : " (dry run; add --apply to write)"}`);
    for (const s of skipped) console.log(`  skip  ${s.path}  (${s.why})`);
    if (!todo.length) return 0;
    let code = 0;
    for (const repo of todo) {
      console.log(`\n== ${repo}`);
      if (run(["init", ...(apply ? [] : ["--dry-run"])], repo) !== 0) code = 1;
    }
    return code;
  }
  if (command === "init") {
    const dryRun = args.flags.has("--dry-run");
    const type = args.values.type;
    if (type !== undefined) {
      const problem = validate("project.type", type);
      if (problem) return fail(problem);
    }
    if (args.flags.has("--upgrade")) return printChanges("saw init --upgrade", "updated", "kept (edited)", upgrade(cwd, { dryRun }), dryRun);
    const { report, guessed, typeIgnored } = initProject(cwd, { dryRun, force: args.flags.has("--force"), type });
    if (guessed) console.log(`  project.type = "${guessed.type}" (guessed from ${guessed.from}; change it with saw config set project.type <t>)`);
    if (typeIgnored) console.error(`warning: workflow.toml already exists, so --type was not applied; run: saw config set project.type ${type}`);
    const hooksPath = Bun.spawnSync(["git", "config", "--get", "core.hooksPath"], { cwd }).stdout.toString().trim();
    if (args.flags.has("--hooks") && hooksPath && hooksPath !== ".githooks" && !args.flags.has("--force")) {
      // Another hook manager (husky, lefthook, ...) owns hooksPath: don't silently disable it.
      console.error(`warning: core.hooksPath is already "${hooksPath}"; not changed. Call saw lint-context from that hook instead, or re-run with --force to replace it.`);
    } else if (args.flags.has("--hooks")) {
      report.changed.push(`git config core.hooksPath .githooks${hooksPath && hooksPath !== ".githooks" ? ` (was ${hooksPath})` : ""}`);
      if (!dryRun) {
        const git = Bun.spawnSync(["git", "config", "core.hooksPath", ".githooks"], { cwd, stderr: "pipe" });
        if (git.exitCode !== 0) return fail(`git config failed: ${git.stderr.toString().trim()}`);
      }
    }
    if (args.values.agents !== undefined) {
      const agents = args.values.agents.split(",").map((a) => a.trim()).filter(Boolean);
      const unknown = agents.filter((a) => !(AGENTS as readonly string[]).includes(a));
      if (unknown.length) return fail(`unknown agent: ${unknown.join(", ")} (one of ${AGENTS.join(", ")})`);
      const a = installAdapters(cwd, agents, dryRun);
      report.installed.push(...a.installed);
      report.skipped.push(...a.skipped);
      console.log(`agents: add them to agents.enabled so saw agents check covers them: saw config set agents.enabled '${JSON.stringify(["claude", ...agents.filter((x) => x !== "claude")])}'`);
    }
    printReport(report, dryRun);
    if (!dryRun) {
      registerProject(cwd);
      const claude = join(cwd, "CLAUDE.md");
      if (existsSync(claude) && !/^@AGENTS\.md/m.test(readFileSync(claude, "utf8"))) {
        console.log("note: your existing CLAUDE.md doesn't import AGENTS.md; add a line `@AGENTS.md` at the top so Claude reads it");
      }
      console.log("next: fill in AGENTS.md by hand (commands + non-obvious rules only), then start the foundation playbook:");
      console.log('  saw task start --tier complex --playbook foundation');
      if (!args.flags.has("--hooks")) console.log("  optional: saw init --hooks  (runs the context lint before each commit)");
      if (!Object.values(aboutPaths(cwd)).some((p) => existsSync(p))) console.log("  optional: saw about-me, then ask Claude to run the about-me skill (your goals and preferences, read by every session)");
    }
    if ("repo" in args.values) initRepoPlan(cwd, args);
    return 0;
  }
  if (command === "outline" && sub) {
    try {
      for (const line of outline(resolvePath(cwd, sub))) console.log(line);
      return 0;
    } catch (e) {
      return fail((e as Error).message);
    }
  }
  if (command === "repo" && (sub === "plan" || sub === "apply")) return repoCommand(resolved.config, sub, args);
  if (command === "uninstall") {
    const dryRun = args.flags.has("--dry-run");
    return printChanges("saw uninstall", "removed", "kept (edited)", uninstall(cwd, { dryRun }), dryRun);
  }
  if (command === "sync") {
    const dryRun = args.flags.has("--dry-run");
    if (!dryRun) {
      mkdirSync(join(cwd, ".saw"), { recursive: true });
      writeFileSync(join(cwd, ".saw", "resolved.json"), JSON.stringify(resolved.config, null, 2) + "\n");
    }
    console.log(`saw sync: ${dryRun ? "would write" : "wrote"} .saw/resolved.json`);
    for (const a of syncAgents(args.values["plugin-dir"] ?? PLUGIN_ROOT, resolved.config, dryRun)) {
      console.log(`  agent ${a.name.padEnd(18)} model: ${a.model}${a.effort ? ` effort: ${a.effort}` : ""}${a.changed ? (dryRun ? " (would change)" : " (changed)") : ""}`);
    }
    if (args.flags.has("--session")) {
      const s = syncSession(cwd, resolved.config, dryRun);
      const keys = Object.entries(s.set).map(([k, v]) => `${k}=${v}`).join(" ");
      console.log(`  session ${keys || "(no plan-phase model/effort to set)"}${s.changed ? (dryRun ? " (would write .claude/settings.local.json)" : " (wrote .claude/settings.local.json; restart to apply)") : ""}`);
    }
    try {
      // --scope global: only the global layer, into Claude Code's user settings.
      const global = args.scoped && args.scope === "global";
      const paths = layerPaths(cwd);
      const none = join(cwd, ".saw", "no-layer.toml");
      const config = global ? resolve(cwd, args.overrides, { global: paths.global, project: none, local: none }).config : resolved.config;
      const target = global ? join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "settings.json") : join(cwd, ".claude", "settings.local.json");
      const track = global ? join(dirname(paths.global), "autocompact.json") : join(cwd, ".saw", "autocompact.json");
      const c = syncCompact(target, track, config, dryRun);
      for (const w of c.warnings) console.log(`  warn ${w}`);
      const keys = [...Object.entries(c.set).map(([k, v]) => `${k}=${v}`), ...c.removed.map((k) => `${k} removed`)];
      if (keys.length) console.log(`  autocompact ${keys.join(" ")}${c.changed ? (dryRun ? ` (would write ${target})` : ` (wrote ${target})`) : ""}`);
    } catch (e) {
      return fail((e as Error).message);
    }
    const models = resolved.config.models as { mode?: string; strong?: string };
    if (models.mode === "single") console.log(`  single-model mode: agents inherit; to pin one model for all subagents set CLAUDE_CODE_SUBAGENT_MODEL=${models.strong}`);
    try {
      const s = syncSkillDenies(cwd, resolved.config, dryRun);
      for (const e of s.added) console.log(`  deny ${e}${dryRun ? " (would add)" : ""} (feature off)`);
      for (const e of s.removed) console.log(`  allow ${e}${dryRun ? " (would remove deny)" : ""} (feature on)`);
      const a = syncAdvisor(cwd, resolved.config, dryRun);
      if (a.kept) console.log(`  advisorModel ${a.kept} (set by you in .claude/settings.local.json; left as is)`);
      else if (a.changed) console.log(`  advisorModel ${a.to ?? "(off)"}${dryRun ? " (would write" : " (wrote"} .claude/settings.local.json)`);
    } catch (e) {
      return fail((e as Error).message);
    }
    return 0;
  }
  if (command === "agents" && sub === "check") {
    const enabled = (resolved.config.agents as { enabled: string[] }).enabled;
    const problems = checkAdapters(cwd, enabled);
    for (const p of problems) console.error(p);
    console.log(problems.length ? `saw agents check: ${problems.length} problem(s)` : `saw agents check: ok (${enabled.join(", ")})`);
    return problems.length ? 1 : 0;
  }
  if (command === "vault" && sub === "sync") {
    if (!(resolved.config.features as Record<string, boolean>).obsidian) return fail("features.obsidian is off");
    const k =resolved.config.knowledge as { store: string; vault_path: string };
    const v = vaultPath(k.vault_path, resolved.sources["knowledge.vault_path"]);
    if (!v.path) return fail(v.error!);
    const dryRun = args.flags.has("--dry-run");
    const r = syncVault(v.path, cwd, k.store, readMetrics(cwd), dryRun);
    for (const w of r.warnings) console.error(`warning: ${w}`);
    console.log(`saw vault sync${dryRun ? " (dry run)" : ""}: ${r.note}${r.copied.length ? `, ${r.copied.length} learnings` : ""}`);
    return 0;
  }
  if (command === "deps") return depsCommand(cwd, resolved.config, args);
  if (command === "about-me") return aboutCommand(cwd, args);
  if (command === "recommend") return recommendCommand(cwd, resolved.config, args);
  if (command === "skills" && sub === "find") {
    if (!printSkillSuggestions(cwd, resolved.config, currentTask(cwd)?.playbook ?? "")) console.log("no skill suggestions for these changes");
    return 0;
  }
  if (command === "dashboard") {
    const features = resolved.config.features as Record<string, boolean>;
    if (!features.dashboard) return fail("features.dashboard is off");
    const d = resolved.config.dashboard as { panels: string[]; output: string; obsidian_note: string };
    const metrics = readMetrics(cwd);
    const out = inside(cwd, d.output);
    // The Obsidian note export follows features.obsidian.
    const note = d.obsidian_note && features.obsidian ? inside(cwd, d.obsidian_note) : undefined;
    if (!out || (d.obsidian_note && features.obsidian && !note)) return fail("dashboard.output and dashboard.obsidian_note must be paths inside the project");
    const proposalsDir = inside(cwd, (resolved.config.retro as { proposals_dir: string }).proposals_dir);
    const proposals = proposalsDir ? readProposals(proposalsDir) : [];
    if (args.flags.has("--serve")) {
      const raw = args.values.port || String(d.port);
      if (!/^\d+$/.test(raw) || Number(raw) > 65535) return fail("--port must be a number from 0 to 65535 (0 picks a free port)");
      // Works from any folder; inside a saw project it opens on that project.
      try {
        const server = serveDashboard(cwd, resolved.config, Number(raw));
        console.log(`saw dashboard: open ${dashboardUrl(server)} (one use; Ctrl+C to stop)`);
      } catch (e) {
        return fail(`could not serve on port ${raw}: ${(e as Error).message}`);
      }
      return SERVING;
    }
    mkdirSync(join(out, ".."), { recursive: true });
    writeFileSync(out, renderHtml(metrics, d.panels, proposals, readRuns(cwd), new Date(), readEvents(cwd, d.events_limit), false, adoption(readEvents(cwd), metrics)));
    console.log(`saw dashboard: ${metrics.length} tasks -> ${out}`);
    if (note) {
      mkdirSync(join(note, ".."), { recursive: true });
      writeFileSync(note, renderMarkdown(metrics, d.panels, proposals, readRuns(cwd)));
      console.log(`  note -> ${note}`);
    }
    return 0;
  }
  if (command === "adoption") {
    const raw = args.values.since;
    if (raw !== undefined && !/^[1-9]\d*$/.test(raw)) return fail("--since must be a whole number of days");
    if (args.flags.has("--features")) {
      const u = featureUsage(Object.keys((DEFAULTS.features ?? {}) as Table), listMods(PLUGIN_ROOT), readEvents(cwd), readMetrics(cwd), raw === undefined ? undefined : Number(raw), new Date(), ((resolved.config.logging ?? {}) as { enabled?: boolean }).enabled === true);
      console.log(args.flags.has("--json") ? JSON.stringify(u, null, 2) : formatFeatureUsage(u));
      return 0;
    }
    const a = adoption(readEvents(cwd), readMetrics(cwd), raw === undefined ? undefined : Number(raw));
    console.log(args.flags.has("--json") ? JSON.stringify(a, null, 2) : formatAdoption(a));
    return 0;
  }
  if (command === "retro") {
    const r = resolved.config.retro as { repeat_threshold: number; proposals_dir: string };
    const features = resolved.config.features as Record<string, boolean>;
    if (!features.retro) return fail("features.retro is off");
    const dir = inside(cwd, r.proposals_dir);
    if (!dir) return fail("retro.proposals_dir must be a path inside the project");
    const autonomy = resolved.config.autonomy as { level: string; actions: Record<string, string> };
    // suggest mode (or self_improve = never) lists candidates without writing files.
    const write = !args.flags.has("--dry-run") && autonomy.level !== "suggest" && autonomy.actions.self_improve !== "never";
    const result = retro(dir, readMetrics(cwd), r.repeat_threshold, write, undefined, failureCandidates(cwd, r.repeat_threshold));
    for (const c of result.pending) {
      console.log(`  ${c.check}: failed in ${c.tasks} tasks${write ? "" : " (not written)"}`);
    }
    for (const f of result.written) console.log(`  proposal -> ${join(r.proposals_dir, f)}`);
    for (const p of result.open) console.log(`  open: ${p.file} (${p.check})`);
    console.log(`saw retro: ${result.pending.length} new, ${result.open.length} open; fill each with the retro-promote skill`);
    const suggestions = configSuggestions(readMetrics(cwd), resolved.config, r.repeat_threshold);
    if (suggestions.length) console.log(`suggested settings (review, then run):\n${suggestions.map((s) => `  ${s}`).join("\n")}`);
    return 0;
  }
  if (command === "eval") return evalCommand(cwd, resolved.config, args);
  if (command === "mods") return modsCommand(args);
  if (command === "projects") return projectsCommand(args);
  if (command === "task") {
    const code = taskCommand(cwd, resolved.config, args);
    // saw task status writes the file itself from the status it printed.
    if (args.positional[1] !== "status") writeStatusFile(cwd, resolved.config);
    return code;
  }
  if (command === "run" && sub) {
    try {
      const r = runCheck(cwd, resolved.config, sub, { changed: args.flags.has("--changed") });
      logEvent(cwd, resolved.config, r.code === 0 ? "info" : "warn", "check", `saw run ${sub}: ${r.code === 0 ? "pass" : `fail (exit ${r.code})`}`, { check: sub, code: r.code });
      writeStatusFile(cwd, resolved.config);
      if (r.shown) console.log(r.shown);
      console.log(`saw run ${sub}: ${r.code === 0 ? "pass" : `fail (exit ${r.code})`}; full log: ${r.log}`);
      return r.code === 0 ? 0 : 1;
    } catch (e) {
      return fail((e as Error).message);
    }
  }
  if (command === "gate") {
    let input = {};
    try {
      input = JSON.parse(readStdin() || "{}");
    } catch {
      // No hook payload (run by hand): treat as a fresh stop.
    }
    const computed: { status?: Status } = {};
    const block = gate(cwd, resolved.config, input, computed);
    if (block) console.log(JSON.stringify(block));
    writeStatusFile(cwd, resolved.config, computed.status);
    try {
      writeCard(cwd);
    } catch {
      // A handoff card is a convenience: never let it break the Stop hook.
    }
    const tier = currentTask(cwd)?.tier;
    if (block) logEvent(cwd, resolved.config, "warn", "gate.block", block.reason, { tier });
    else if (tier) logEvent(cwd, resolved.config, "info", "gate.pass", `stop allowed (${tier})`, { tier });
    // A Stop in a saw project with no task open: the adoption report's main miss.
    else if (isSawProject(cwd)) logEvent(cwd, resolved.config, "info", "gate.untasked", "stop allowed with no saw task open");
    return 0;
  }
  if (command === "context") {
    let input = {};
    try {
      input = JSON.parse(readStdin() || "{}");
    } catch {
      // No hook payload: nothing to measure.
    }
    const budget = budgetHook(cwd, resolved.config, currentTask(cwd), input);
    if (budget) logEvent(cwd, resolved.config, "warn", "budget", String(budget.systemMessage));
    const nudge = routerNudge(cwd, resolved.config, typeof (input as { prompt?: unknown }).prompt === "string" ? (input as { prompt: string }).prompt : undefined);
    const auto = currentTask(cwd);
    if (auto?.provisional) logEvent(cwd, resolved.config, "info", "tier", `${auto.tier} / ${auto.playbook} (provisional, routing.auto)`, { tier: auto.tier, playbook: auto.playbook, provisional: true });
    if (nudge) logEvent(cwd, resolved.config, "info", "nudge", "no saw task open: pointed the agent at the router skill");
    const rec = recommendHook(cwd, resolved.config, input);
    if (rec) logEvent(cwd, resolved.config, "info", "recommend", "suggested MCP servers or skills for this prompt");
    const outs = [nudge, contextHook(cwd, resolved.config, input), budget, rec].filter((o) => o !== undefined);
    if (outs.length === 1) console.log(JSON.stringify(outs[0]));
    else if (outs.length > 1) {
      // One hook, one JSON object: join the nudges.
      const text = (o: Record<string, unknown>, k: string): string => k === "systemMessage" ? o.systemMessage as string : (o.hookSpecificOutput as { additionalContext: string }).additionalContext;
      console.log(JSON.stringify({
        systemMessage: outs.map((o) => text(o, "systemMessage")).filter(Boolean).join("\n") || undefined,
        hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: outs.map((o) => text(o, "additionalContext")).join("\n") },
      }));
    }
    return 0;
  }
  if (command === "resume") {
    const r = resume(cwd);
    for (const l of r.lines) console.log(l);
    return r.ok ? 0 : 1;
  }
  if (command === "session-start") {
    let input = {};
    try {
      input = JSON.parse(readStdin() || "{}");
    } catch {
      // No hook payload: no model to check.
    }
    const warning = planModelWarning(resolved.config, input);
    if (warning) logEvent(cwd, resolved.config, "warn", "model.plan", String(warning.systemMessage));
    const about = aboutHook(cwd, resolved.config.features as Record<string, boolean>);
    // Companion plugins are soft dependencies (see COMPANIONS): say which features are off without them.
    const installed = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "plugins", "installed_plugins.json");
    // The desktop app syncs plugins to plugins/synced instead of installed_plugins.json.
    const missing = companionWarnings(existsSync(installed) ? readFileSync(installed, "utf8") : undefined, resolved.config.features as Record<string, boolean>, readSyncedPluginNames(join(dirname(installed), "synced"))).map((m) => `saw: ${m}`);
    for (const m of missing) logEvent(cwd, resolved.config, "warn", "plugin.companion", m);
    const source = (input as { source?: string }).source;
    const hint = resumeHint(cwd, source);
    // Baseline for the Stop gate: a working tree that differs later was changed without an edit hook (shell writes).
    const sid = (input as { session_id?: string }).session_id;
    const tree = sid && isSawProject(cwd) ? gitStatusHash(cwd) : undefined;
    if (sid && tree && !storedTreeHash(cwd, sid)) storeTreeHash(cwd, sid, tree); // resume and compact keep the first baseline
    // A repo the workflow isn't set up in gets no routing at all: say so, once per session.
    const unset = existsSync(join(cwd, ".git")) && !isSawProject(cwd) && (source === undefined || source === "startup") ? "saw is not set up here: run `saw init` or /workflow-setup" : undefined;
    // A task another session left open, and the last task that was closed unverified (shown once).
    const stale = isSawProject(cwd) ? staleTask(cwd, sid) : undefined;
    const staleLine = stale ? `saw: ${staleMessage(stale)}${routingMode(resolved.config) === "hard" ? "; edits stay denied until then" : ""}` : undefined;
    const unverified = isSawProject(cwd) && (source === undefined || source === "startup" || source === "clear") ? takeUnverifiedExit(cwd) : undefined;
    // No [checks] commands: no task can be Verified. Said once, at the start of a session.
    const noChecks = isSawProject(cwd) && (source === undefined || source === "startup") ? noChecksWarning(resolved.config) : undefined;
    const noChecksLine = noChecks ? `saw: ${noChecks}` : undefined;
    const unverifiedLine = unverified ? `saw: the last ${unverified.tier}/${unverified.playbook} task was closed ${unverified.label} (${unverified.at.slice(0, 16).replace("T", " ")}): ${unverified.reason}` : undefined;
    const context = [(warning?.hookSpecificOutput as { additionalContext?: string } | undefined)?.additionalContext, about, hint, staleLine, unverifiedLine, noChecksLine, ...missing, unset].filter(Boolean).join("\n\n");
    const systemMessage = [warning?.systemMessage, staleLine, unverifiedLine, noChecksLine, ...missing, unset].filter(Boolean).join("\n") || undefined;
    if (context || systemMessage) console.log(JSON.stringify({ systemMessage, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }));
    return 0;
  }
  // PostToolUseFailure: the agent sees the error, but nothing kept it. Log
  // which tool failed, on what, and the end of the error.
  // SubagentStop: the subagent's edits count against the open task (or arm the
  // untasked-edit Stop check when none is open). Never blocks.
  if (command === "subagent-hook") {
    let input = {};
    try {
      input = JSON.parse(readStdin() || "{}");
    } catch {
      // No payload: nothing to record.
    }
    subagentHook(cwd, resolved.config, input);
    return 0;
  }
  if (command === "failure-hook") {
    let input: { tool_name?: string; tool_input?: { command?: unknown; file_path?: unknown }; error?: unknown; is_interrupt?: boolean } = {};
    try {
      input = JSON.parse(readStdin() || "{}");
    } catch {
      // No hook payload: nothing to log.
    }
    const target = String(input.tool_input?.command ?? input.tool_input?.file_path ?? "").slice(0, 200);
    const error = String(input.error ?? "").trim().slice(-500);
    logEvent(cwd, resolved.config, "warn", "tool.fail", `${input.tool_name ?? "tool"} failed${input.is_interrupt ? " (interrupted)" : ""}: ${target}`, { tool: input.tool_name, target, error });
    const figma = figmaFallback(resolved.config, input);
    if (figma) console.log(JSON.stringify(figma));
    return 0;
  }
  if (command === "guard" || command === "format-hook" || command === "session-hook") {
    let input: object = guardInput;
    if (command !== "guard") {
      try {
        input = JSON.parse(readStdin() || "{}");
      } catch {
        // No hook payload: nothing to check.
      }
    }
    const out = command === "guard" ? guardHook(resolved.config, input, cwd)
      : command === "session-hook" ? sessionHook(cwd, resolved.config, input)
      : formatHook(cwd, resolved.config, input, resolved.sources["checks.format"]);
    if (out) console.log(JSON.stringify(out));
    if (command === "guard" && out) {
      const h = out.hookSpecificOutput as { permissionDecision?: string; permissionDecisionReason?: string; updatedInput?: { command?: string } };
      if (h.updatedInput) logEvent(cwd, resolved.config, "info", "guard.rewrite", `rewritten to ${h.updatedInput.command}`);
      else logEvent(cwd, resolved.config, h.permissionDecision === "deny" ? "warn" : "info", `guard.${h.permissionDecision}`, String(h.permissionDecisionReason));
    }
    if (command === "guard" && !out) {
      const i = input as { tool_name?: string; tool_input?: { command?: unknown; file_path?: unknown } };
      logEvent(cwd, resolved.config, "debug", "guard.allow", `${i.tool_name ?? "tool"}: ${String(i.tool_input?.command ?? i.tool_input?.file_path ?? "").slice(0, 200)}`);
    }
    if (command === "format-hook") {
      const path = (input as { tool_input?: { file_path?: unknown; notebook_path?: unknown } }).tool_input;
      const file = path?.file_path ?? path?.notebook_path;
      const filePath = typeof file === "string" ? file : undefined;
      // Soft routing with routing.auto = open: an edit with no task opens a provisional one
      // instead of arming the Stop gate, so normal prompting isn't interrupted.
      const routing = (resolved.config.routing ?? {}) as { mode?: string; auto?: string };
      if (routing.mode !== "hard" && routing.auto === "open" && editOpensProvisional(cwd, filePath)) {
        try { openProvisional(cwd, "standard", "feature", filePath); } catch { markUntaskedEdit(cwd, filePath); }
      } else markUntaskedEdit(cwd, filePath);
    }
    if (command === "format-hook") {
      const source = resolved.sources["checks.format"];
      const skipped = !(resolved.config.checks as Record<string, string> | undefined)?.format ? "no checks.format set"
        : !TRUSTED_LAYERS.includes(source ?? "") ? `checks.format comes from the ${source} layer (workflow.toml); only ~/.saw/config.toml or workflow.local.toml run on edits`
        : undefined;
      logEvent(cwd, resolved.config, out ? "warn" : "debug", "format", out ? "checks.format failed" : skipped ? `format-hook skipped: ${skipped}` : "format-hook ran: checks.format passed");
    }
    return 0;
  }
  if (command === "memory" && sub === "lint") {
    const problems = lintMemory(cwd, resolved.config);
    for (const p of problems) console.error(p);
    console.log(problems.length ? `saw memory lint: ${problems.length} problem(s)` : "saw memory lint: ok");
    return problems.length ? 1 : 0;
  }
  if (command === "split") {
    if (!sub || !existsSync(sub)) return fail("usage: saw split <plan.md> [--dry-run]");
    const split = parseSplit(readFileSync(sub, "utf8"));
    if (split.problems.length) {
      for (const p of split.problems) console.error(`problem: ${p}`);
      return 1;
    }
    const units = planSplit(split, cwd);
    const base = ((resolved.config.branch ?? {}) as { base?: string }).base || "main";
    if (args.flags.has("--dry-run")) {
      for (const u of units) console.log(`would add ${u.path} on ${u.branch} (${u.title})`);
      return 0;
    }
    const results = applySplit(units, split.context, base, cwd);
    for (const r of results) console.log(`${r.ok ? "added" : "skipped"} ${r.message}`);
    console.log("\nStart a session in each:");
    for (const r of results.filter((x) => x.ok)) console.log(`  cd "${r.unit.path}" && claude "Read .saw/brief.md and do that step only"`);
    return results.every((r) => r.ok) ? 0 : 1;
  }
  if (command === "release") {
    if (sub === "tag") {
      const r = tagRelease(cwd, { dryRun: args.flags.has("--dry-run"), allowBranch: args.flags.has("--allow-branch") });
      for (const p of r.problems) console.error(`problem: ${p}`);
      if (r.problems.length) return 1;
      console.log(args.flags.has("--dry-run") ? `saw release tag: would tag ${r.tag}` : `tagged ${r.tag}. Publish with: git push origin ${r.tag}`);
      return 0;
    }
    if (sub === "notes" || sub === "verify") {
      if (!key) return fail(`usage: saw release ${sub} <tag>`);
      if (sub === "verify") {
        const problems = verifyTag(cwd, key);
        for (const p of problems) console.error(`problem: ${p}`);
        console.log(problems.length ? `saw release verify: ${problems.length} problem(s)` : `saw release verify: ${key} ok`);
        return problems.length ? 1 : 0;
      }
      const notes = notesFor(readIfExists(join(cwd, "CHANGELOG.md")) ?? "", key);
      if (!notes) return fail(`no CHANGELOG.md section for ${key}`);
      process.stdout.write(notes);
      return 0;
    }
    const dryRun = args.flags.has("--dry-run");
    const releaseFlow = flatten(resolved.config)["release.flow"] === "release-branch" ? "release-branch" : "main";
    let result: ReturnType<typeof release>;
    try {
      result = release(cwd, { bump: sub, pre: args.values.pre || undefined, dryRun, all: args.flags.has("--all"), allowBranch: args.flags.has("--allow-branch"), flow: releaseFlow });
    } catch (e) {
      return fail((e as Error).message);
    }
    console.log(`saw release ${result.tag}${dryRun ? " (dry run, nothing written)" : ""}`);
    for (const f of result.files) console.log(`  ${dryRun ? "would write" : "wrote"} ${f}`);
    console.log("", result.notes);
    if (result.problems.length) {
      for (const p of result.problems) console.error(`problem: ${p}`);
      return 1;
    }
    if (!dryRun && releaseFlow === "release-branch") console.log(`committed ${result.tag}. Next: git push, open a PR from this branch into main, merge it, then on main run saw release tag and git push origin ${result.tag}`);
    else if (!dryRun) console.log(`committed and tagged ${result.tag}. Publish with: git push origin main --follow-tags`);
    return 0;
  }
  if (command === "sanitize") {
    if (resolved.sources["release.names"] === "project") {
      return fail("release.names lists your own names: set it in ~/.saw/config.toml or workflow.local.toml, not workflow.toml");
    }
    let findings;
    try {
      findings = args.flags.has("--history") ? sanitizeHistory(cwd, resolved.config) : sanitize(cwd, resolved.config);
    } catch (e) {
      return fail((e as Error).message);
    }
    for (const f of findings) console.error(`${f.file}:${f.line}: ${f.kind}: ${f.match}`);
    console.log(findings.length ? `saw sanitize: ${findings.length} finding(s)` : "saw sanitize: ok");
    return findings.length ? 1 : 0;
  }
  if (command === "review-session") return reviewSessionCommand(cwd, resolved.config, args);
  if (command === "autopilot") return autopilotCommand(cwd, resolved.config, weakenedSafety(resolved), args);
  if (command === "plan") return planCommand(cwd, resolved.config, args);
  if (command === "style") {
    console.log(styleLine(effectiveStyle(resolved.config, currentTask(cwd))));
    return 0;
  }
  if (command === "style-check") {
    let input = {};
    try {
      input = JSON.parse(readStdin() || "{}");
    } catch {
      // No hook payload: nothing to count.
    }
    const out = styleCheck(cwd, resolved.config, input);
    if (out) console.log(JSON.stringify(out));
    return 0;
  }
  if (command === "lint-context") {
    const problems = lintContext(cwd, resolved.config);
    for (const p of problems) console.error(p);
    return problems.length ? 1 : 0;
  }
  console.log(USAGE);
  return command === undefined || command === "help" ? 0 : 1;
}

function reviewSessionCommand(cwd: string, config: Table, args: Args): number {
  const sub = args.positional[1];
  const review = config.review_session as ReviewSettings;
  if (!review.enabled) return fail("review_session.enabled is false");
  const kind = args.values.unit;
  const id = args.values["unit-id"];
  if (!kind || !(UNITS as readonly string[]).includes(kind) || !id) return fail(`--unit ${UNITS.join("|")} --unit-id <name> are required`);
  const tier = currentTask(cwd)?.tier ?? "standard";
  if (!reviewApplies(config, kind, tier)) {
    console.log(`saw review-session: skipped (${kind} not in review_session.when, or tier ${tier} has budget 0)`);
    return 0;
  }
  const brief = reviewBrief(cwd, config, kind, id, tier);
  const done = (report: string, how: "ran" | "recorded"): number => {
    const rec = recordReview(cwd, kind, id, review.mode ?? "both", report, new Date(), how);
    logEvent(cwd, config, rec.findings ? "warn" : "info", "review.result", `${rec.findings} finding(s) for ${kind} ${id}`, { unit: kind, id, findings: rec.findings });
    console.log(report.trim());
    if (!rec.verdict) {
      console.log(`saw review-session: the report has no \`verdict:\` line, so the review didn't finish and doesn't count; run it again or record a full report with \`saw review-session record\``);
      return 1;
    }
    console.log(`saw review-session: ${rec.findings} finding(s) recorded for ${kind} ${id}; fix or answer each before the PR`);
    return 0;
  };
  if (sub === "brief") {
    console.log(brief);
    return 0;
  }
  if (sub === "record") {
    const file = args.positional[2];
    if (!file || !existsSync(file)) return fail("usage: saw review-session record <report file> --unit <kind> --unit-id <name>");
    return done(readFileSync(file, "utf8"), "recorded");
  }
  if (sub === "run") {
    const argv = reviewArgv();
    if (args.flags.has("--dry-run")) {
      console.log(`saw review-session: would run ${argv.join(" ")} < brief`);
      return 0;
    }
    logEvent(cwd, config, "info", "review.start", `review session for ${kind} ${id} (${tier})`, { unit: kind, id, tier });
    let p: ReturnType<typeof Bun.spawnSync>;
    try {
      p = Bun.spawnSync(argv, { cwd, stdin: Buffer.from(reviewBrief(cwd, config, kind, id, tier, writeChange(cwd, config, id))), stdout: "pipe", stderr: "inherit" });
    } catch (e) {
      return fail(`could not start claude (${(e as Error).message}); open the review yourself with saw review-session brief`);
    }
    if (p.exitCode !== 0) return fail(`the review session failed (claude exit ${p.exitCode}); nothing recorded`);
    return done(p.stdout.toString(), "ran");
  }
  return fail("usage: saw review-session brief|run [--dry-run]|record <file> --unit <kind> --unit-id <name>");
}

function autopilotCommand(cwd: string, config: Table, weakened: string[], args: Args): number {
  const s = autopilotSettings(config);
  const queue = inside(cwd, s.queue);
  if (!queue) return fail("autopilot.queue must be a path inside the project");
  if (args.flags.has("--install-schedule")) {
    console.log("saw autopilot: register it yourself with (not run):");
    console.log(`  ${scheduleCommand(resolvePath(cwd))}`);
    return 0;
  }
  const state = autopilotState(cwd);
  if (args.positional[1] === "status" || args.flags.has("--dry-run")) {
    const items = existsSync(queue) ? parseQueue(readFileSync(queue, "utf8")) : [];
    const git = (a: string[]): { code: number; out: string } => {
      try {
        const p = Bun.spawnSync(["git", ...a], { cwd, stdout: "pipe", stderr: "pipe" });
        return { code: p.exitCode ?? 1, out: p.stdout.toString() };
      } catch {
        return { code: 1, out: "" };
      }
    };
    const plan = planQueue(items, state, config, { git });
    // The in-flight item shows as `current` with its saved base, not as planned.
    plan.order = plan.order.filter((p) => p.item.slug !== state.current?.slug);
    console.log(`saw autopilot: ${plan.order.length} approved item(s) left in ${s.queue}; spent $${state.spent_usd.toFixed(2)} of $${s.max_total_usd}`);
    for (const w of autoApproveTiers(config).warnings) console.log(`  warning: ${w}`);
    if (plan.cycle) console.log(`  would stop: dependency cycle: ${plan.cycle.join(" -> ")}`);
    plan.order.forEach((p, n) => console.log(`  ${String(n + 1).padStart(2)}. ${p.item.slug} from ${p.base}${p.item.status === "proposed" ? ` (auto-approved: ${p.item.tier})` : ""}${p.item.text ? `: ${p.item.text}` : ""}`));
    for (const k of plan.skipped) console.log(`  skip  ${k.slug}: ${k.reason}`);
    if (state.current) console.log(`  current ${state.current.slug} (${state.current.branch}${state.current.base ? ` from ${state.current.base}` : ""}, session ${state.current.session_id}${state.current.until ? `, waiting until ${state.current.until}` : ""})`);
    for (const [slug, o] of Object.entries(state.done)) console.log(`  ${o.padEnd(6)} ${slug}`);
    for (const r of stopReasons(cwd, config, state, weakened)) console.log(`  would stop: ${r}`);
    return 0;
  }
  // A scheduled run must not start a second runner beside one still going.
  const lock = join(cwd, ".saw", "autopilot.lock");
  const held = readIfExists(lock);
  if (held !== undefined) {
    const pid = Number(held);
    try {
      process.kill(pid, 0);
      console.log(`saw autopilot: already running (pid ${pid})`);
      return 0;
    } catch {
      // Stale lock from a runner that died: take it over.
    }
  }
  mkdirSync(join(cwd, ".saw"), { recursive: true });
  writeFileSync(lock, String(process.pid));
  try {
    const tool = (bin: string) => (a: string[]): { code: number; out: string } => {
      try {
        const p = Bun.spawnSync([bin, ...a], { cwd, stdout: "pipe", stderr: "pipe" });
        return { code: p.exitCode ?? 1, out: p.stdout.toString() + p.stderr.toString() };
      } catch (e) {
        return { code: 127, out: `${bin} not found: ${(e as Error).message}` };
      }
    };
    return autopilot(cwd, config, weakened, {
      claude: spawnClaude(cwd),
      git: tool("git"),
      gh: tool("gh"),
      sleep: (ms) => Bun.sleepSync(ms),
      now: () => new Date(),
      uuid: () => crypto.randomUUID(),
      log: (l) => {
        console.log(`saw autopilot: ${l}`);
        logEvent(cwd, config, l.startsWith("stop:") || l.includes("parked") ? "warn" : "info", "autopilot", l);
      },
    }, { once: args.flags.has("--once") });
  } finally {
    rmSync(lock, { force: true });
  }
}

function planCommand(cwd: string, config: Table, args: Args): number {
  const goal = args.positional.slice(1).join(" ").trim();
  if (!goal) return fail('usage: saw plan "<goal>" [--dry-run]');
  const queue = inside(cwd, autopilotSettings(config).queue);
  if (!queue) return fail("autopilot.queue must be a path inside the project");
  return plan(cwd, config, goal, queue, { claude: spawnClaude(cwd), changed: () => gitChanged(cwd), uuid: () => crypto.randomUUID(), log: (l) => console.log(`saw plan: ${l}`) }, { dryRun: args.flags.has("--dry-run"), base: baseBranch(config) });
}

// Paths with uncommitted changes, relative to the repo root.
function gitChanged(cwd: string): string[] {
  const p = Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=all"], { cwd, stdout: "pipe", stderr: "pipe" });
  return p.stdout.toString().split("\n").filter(Boolean).map((l) => l.slice(3).replace(/^.* -> /, "").replace(/^"|"$/g, ""));
}

const NO_TASK = "no open task; start one with saw task start --tier <t> --playbook <p>";

function taskCommand(cwd: string, config: Table, args: Args): number {
  const [, sub, name, status] = args.positional;
  try {
    // adhoc: a one-off edit outside any plan, routed as trivial so the Stop gate
    // has something to verify against.
    if (sub === "adhoc") args.values.tier = "trivial";
    if (sub === "start" || sub === "adhoc") {
      const tone = args.values.tone;
      if (tone !== undefined && !(TONES as readonly string[]).includes(tone)) return fail(`--tone must be one of ${TONES.join(" | ")}`);
      const rawCap = args.values["max-words"];
      if (rawCap !== undefined && !/^[1-9]\d*$/.test(rawCap)) return fail("--max-words must be a positive whole number");
      // --unit / --unit-id are read by saw session-hook from the command itself.
      const unit = args.values.unit;
      if (unit !== undefined && !(UNITS as readonly string[]).includes(unit)) return fail(`--unit must be one of ${UNITS.join(" | ")}`);
      if ((unit === undefined) !== (args.values["unit-id"] === undefined) || args.values["unit-id"] === "") return fail("--unit and --unit-id <name> go together");
      const playbook = args.values.playbook ?? "feature";
      if (playbook === "audit" && !(config.features as Record<string, boolean>).audit) return fail("features.audit is off");
      const tier = pickTier(config, args.values.tier);
      const bs = branchSettings(config);
      const plan = planBranch(bs, tier, currentBranch(cwd), args.values.branch, !!(config.features as Record<string, boolean>).worktrees, cwd);
      if (plan.reason && sub === "start") return fail(`branch_guard: ${plan.reason}`);
      const moved = applyBranch(plan, bs, cwd);
      if (!moved.ok) return fail(`branch_guard: ${moved.message}`);
      if (moved.message) console.log(`branch: ${moved.message}`);
      const t = startTask(plan.action === "worktree" && plan.path ? plan.path : cwd, tier, playbook, {
        tone,
        max_words: rawCap === undefined ? undefined : Number(rawCap),
      }, args.accepts);
      if (plan.action === "worktree" && plan.path && plan.name) markWorktreeTask(cwd, plan.path, plan.name);
      registerProject(cwd);
      console.log(`task: ${t.tier} / ${t.playbook} · ${styleLine(effectiveStyle(config, t))}`);
      logEvent(cwd, config, "info", "tier", `${t.tier} / ${t.playbook}`, { tier: t.tier, playbook: t.playbook, requested: args.values.tier ?? null });
      console.log(`steps: ${taskSteps(config, t.tier, t.playbook).join(" · ")}`);
      (t.accept ?? []).forEach((c, i) => console.log(`accept:${i + 1} ${c}`));
      const features = (config.features ?? {}) as Record<string, boolean>;
      if (features.task_skills && t.tier !== "trivial") {
        const missing = missingSkillPlugins(taskSkills(config, t.tier, t.playbook), installedNames(cwd));
        if (missing.length) console.log(`skills not installed: ${missing.map((p) => `${p} plugin`).join(", ")}. Ask the user, then install it with /plugin (or turn features.task_skills off)`);
      }
      return 0;
    }
    if (sub === "end") {
      const open = currentTask(cwd);
      if (!open) return fail(NO_TASK);
      const features = config.features as Record<string, boolean>;
      // Validated before anything is written, so a failed end leaves no trace.
      const raw = args.values.tokens;
      const tokens = raw === undefined ? undefined : /^\d+$/.test(raw) ? Number(raw) : NaN;
      if (features.metrics && tokens !== undefined && Number.isNaN(tokens)) return fail("--tokens must be a whole number");
      // Closing a task that isn't Verified is allowed, but says why and is shown to the user next session.
      const status = taskStatus(cwd, config, open);
      const reason = (args.values.reason ?? "").trim();
      // verify.mode hard asks for the why; soft records the exit without one.
      if (status.label !== "Verified" && !reason && verifyMode(config) === "hard") return fail(`the ${open.tier} task is ${status.label} (${statusProblems(status)}). Run the checks, or close it with saw task end --reason "<why>"`);
      if (status.label !== "Verified") {
        noteUnverifiedExit(cwd, { label: status.label, reason, tier: open.tier, playbook: open.playbook, at: new Date().toISOString() });
        logEvent(cwd, config, "warn", "task.unverified", `${open.tier} task closed ${status.label}: ${reason}`, { label: status.label, reason, tier: open.tier, failed: status.failed, missing: status.missing, unconfigured: status.unconfigured, ...(status.floor ? { floor: status.floor } : {}) });
      } else {
        // verify.mode hard with no task open: commits pass only for the tree this task verified.
        recordVerifiedTree(cwd);
      }
      if (features.metrics) {
        const m = buildMetric(cwd, config, open, tokens, undefined, status);
        appendMetric(cwd, m);
        console.log(`task closed: ${m.label}${m.tokens !== undefined ? `, ${m.tokens} tokens (${m.tokens_source})` : ""}`);
      } else {
        console.log("task closed");
      }
      if (features.skill_finder) printSkillSuggestions(cwd, config, open.playbook);
      if (features.living_docs) for (const line of docsNudge(cwd, baseBranch(config))) console.log(line);
      endTask(cwd);
      return 0;
    }
    const task = currentTask(cwd);
    if (!task) return fail(NO_TASK);
    if (sub === "retier" && name) {
      const t = retierTask(cwd, config, name);
      console.log(`task: ${t.tier} / ${t.playbook} (retiered from ${task.tier})`);
      logEvent(cwd, config, "info", "tier", `retier ${task.tier} -> ${t.tier}`, { tier: t.tier, from: task.tier, retier: true });
      console.log(`steps: ${taskSteps(config, t.tier, t.playbook).join(" · ")}`);
      return 0;
    }
    if (sub === "phase" && name) {
      setPhase(cwd, name);
      console.log(`phase: ${name}`);
      logEvent(cwd, config, "info", "phase", name, { tier: task.tier });
      return 0;
    }
    if (sub === "accept" && name === "add" && status !== undefined) {
      const n = addAcceptance(cwd, status);
      console.log(`accept:${n} ${status.trim()}`);
      return 0;
    }
    if (sub === "record" && name && (status === "pass" || status === "fail")) {
      const refused = acceptanceProblem(task, name, status, args.values.note);
      if (refused) return fail(refused);
      const evidence = reviewEvidence(cwd, config, task, name, status, args.values.report);
      if (evidence.problem) {
        logEvent(cwd, config, "warn", "review.refused", `${name} pass not recorded: ${evidence.problem}`, { check: name });
        return fail(evidence.problem);
      }
      recordCheck(cwd, { name, status, how: "recorded", note: args.values.note, report: evidence.report });
      console.log(`recorded ${name}: ${status}${evidence.report ? ` (report: ${evidence.report})` : ""}`);
      return 0;
    }
    if (sub === "report") {
      const body = taskReport(cwd, config, task);
      console.log(body);
      if (!args.flags.has("--post")) return 0;
      // Posting to the PR is outward-facing: autonomy.actions.open_pr decides.
      const autonomy = config.autonomy as { level: string; actions: Record<string, string> };
      if (autonomy.level === "suggest" || autonomy.actions.open_pr === "never") return fail("posting is off (autonomy.actions.open_pr = never, or autonomy.level = suggest)");
      if (autonomy.actions.open_pr === "ask" && !args.flags.has("--yes")) return fail("posting needs your OK: re-run with --yes (autonomy.actions.open_pr = ask)");
      const r = gh(["pr", "comment", ...(args.values.pr ? [args.values.pr] : []), "--body-file", "-"], body);
      if (r.code !== 0) return fail(`gh pr comment failed: ${r.out.trim()}`);
      console.log(r.out.trim());
      return 0;
    }
    if (sub === "pr-body") {
      // The commits since the base branch, then the verification section: pipe to gh pr create --body-file -.
      const base = args.values.base || `origin/${((config.branch ?? {}) as { base?: string }).base || "main"}`;
      if (!SAFE_REF.test(base.replace(/^origin\//, ""))) return fail(`"${base}" is not a branch name`);
      console.log(prBody(commitsSince(cwd, base), taskReport(cwd, config, task)));
      return 0;
    }
    if (sub === "status") {
      const s = taskStatus(cwd, config, task);
      writeStatusFile(cwd, config, s);
      console.log(`${task.tier} / ${task.playbook}: ${s.label}${task.provisional ? " (provisional: confirm with saw task retier)" : ""}`);
      if (s.passed.length) console.log(`  passed  ${s.passed.join(", ")}`);
      if (s.failed.length) console.log(`  failed  ${s.failed.join(", ")}`);
      if (s.missing.length) console.log(`  not run ${s.missing.join(", ")}`);
      if (s.floor) console.log(`  tier too low: ${s.floor}`);
      if (s.unconfigured.length) console.log(`  not configured ${s.unconfigured.join(", ")} (set checks.<name> in workflow.toml, or list it in verify.allow_unconfigured)`);
      if (s.waived.length) console.log(`  skipped (verify.allow_unconfigured) ${s.waived.join(", ")}`);
      if (s.acceptance?.length) {
        console.log("  acceptance criteria");
        for (const a of s.acceptance) console.log(`  ${acceptanceLine(a)}`);
      }
      return 0;
    }
  } catch (e) {
    return fail((e as Error).message);
  }
  return fail(USAGE);
}

function depsCommand(cwd: string, config: Table, args: Args): number {
  const [, sub, name, sha] = args.positional;
  const deps = config.deps as { lock: string; allowed_licences: string[] };
  const lockPath = join(existsSync(join(cwd, deps.lock)) ? cwd : PLUGIN_ROOT, deps.lock);
  const lock = readLock(lockPath);
  try {
    if (sub === "list") {
      for (const [n, d] of Object.entries(lock)) console.log(`${n.padEnd(20)} ${d.sha.slice(0, 12)} ${d.licence.padEnd(8)} reviewed by ${d.reviewed_by}`);
      return 0;
    }
    if (sub === "verify") {
      const v = verifyLock(lock, deps.allowed_licences);
      for (const e of v.errors) console.error(`error: ${e}`);
      for (const p of v.pending) console.error(`pending: ${p}`);
      const failed = v.errors.length > 0 || (args.flags.has("--strict") && v.pending.length > 0);
      console.log(failed ? "saw deps verify: failed" : `saw deps verify: ok (${Object.keys(lock).length} pinned)`);
      return failed ? 1 : 0;
    }
    if (sub === "diff" && name && sha) {
      const dep = lock[name];
      if (!dep) return fail(`no dependency "${name}"`);
      console.log(compareUrl(dep, sha));
      console.log("Review every changed file (skills can run commands before the model reads them), then: saw deps pin");
      return 0;
    }
    if (sub === "pin" && name && sha) {
      // The plugin's own lock is changed only from inside the saw repo, never as a side effect in a user project.
      if (lockPath.startsWith(PLUGIN_ROOT) && resolvePath(cwd) !== resolvePath(PLUGIN_ROOT)) {
        return fail(`no ${deps.lock} in this project; run saw deps pin from the sams-agentic-workflow repo to change its pins`);
      }
      pin(lockPath, name, sha, args.values["reviewed-by"] ?? "");
      console.log(`pinned ${name} at ${sha.slice(0, 12)}`);
      return 0;
    }
  } catch (e) {
    return fail((e as Error).message);
  }
  return fail(USAGE);
}

function aboutCommand(cwd: string, args: Args): number {
  const paths = aboutPaths(cwd);
  if (args.positional[1] === "show") {
    const text = aboutHook(cwd, { about_me: true }, paths);
    console.log(text ?? `no answers yet; run saw about-me, then the about-me skill (files: ${Object.values(paths).join(", ")})`);
    return 0;
  }
  const scope = (args.scoped ? args.scope : "global") as AboutScope;
  if (!(scope in paths)) return fail("--scope must be global, project or local");
  const dryRun = args.flags.has("--dry-run");
  const made = createAbout(paths[scope], dryRun);
  console.log(`${made ? (dryRun ? "would create" : "created") : "kept"} ${paths[scope]}`);
  console.log("next: fill it in by hand, or ask Claude to run the about-me skill (an interview of ~50 questions)");
  return 0;
}

function recommendCommand(cwd: string, config: Table, args: Args): number {
  const [, sub, id] = args.positional;
  const inst = installedNames(cwd);
  const state = readRecommendState(cwd);
  if (sub === "list" || sub === undefined) {
    for (const r of catalog()) {
      const status = isInstalled(r, inst) ? "installed" : state.dismissed.includes(r.id) ? "dismissed" : "available";
      console.log(`${r.kind.padEnd(7)} ${r.id.padEnd(18)} ${status.padEnd(10)} ${r.why}`);
    }
    return 0;
  }
  const rec = catalog().find((r) => r.id === id);
  if (!rec) return fail(`no recommendation "${id ?? ""}"; see saw recommend list`);
  if (sub === "dismiss") {
    writeState(cwd, { ...state, dismissed: [...new Set([...state.dismissed, rec.id])] });
    console.log(`dismissed ${rec.id}: saw won't suggest it again in this project`);
    return 0;
  }
  if (sub === "add") {
    const scope = args.scoped ? args.scope : "";
    if (args.scoped && !["global", "project", "local"].includes(scope)) return fail("--scope must be global, project or local");
    const steps = installSteps(rec, scope);
    for (const argv of steps) {
      console.log(`$ ${argv.join(" ")}`);
      if (args.flags.has("--dry-run")) continue;
      const p = Bun.spawnSync(argv, { cwd, stdout: "inherit", stderr: "inherit" });
      if (p.exitCode !== 0) return fail(`${argv.slice(0, 3).join(" ")} failed (exit ${p.exitCode})`);
    }
    if (!args.flags.has("--dry-run")) {
      console.log(`added ${rec.id}${rec.kind === "mcp" ? "; if it needs sign-in, run /mcp in Claude Code" : "; restart Claude Code to load it"}`);
      logEvent(cwd, config, "info", "recommend.add", rec.id);
    }
    return 0;
  }
  return fail(USAGE);
}

// Prints catalog skills that fit the task; true when it printed any.
function printSkillSuggestions(cwd: string, config: Table, playbook: string): boolean {
  const found = findSkills(cwd, config, playbook, changedFiles(cwd));
  if (found.length === 0) return false;
  console.log("skills that may help with work like this:");
  for (const r of found) console.log(`  ${offer(config, r)}`);
  return true;
}

function projectsCommand(args: Args): number {
  const [, sub, target] = args.positional;
  if (sub === "list" || sub === undefined) {
    const list = listProjects();
    if (!list.length) console.log("no projects yet: saw init and saw task start add them, or run saw projects add <path>");
    for (const p of list) console.log(`${inspectProject(p.path).state.padEnd(16)} ${p.name}  ${p.path}`);
    return 0;
  }
  if (sub === "add" && target) {
    const r = addProject(target);
    if (!r.ok) return fail(r.problem ?? "could not add the project");
    const state = r.inspection!.state;
    console.log(`added ${r.project!.path} (${state})`);
    for (const p of r.inspection!.problems) console.log(`  ${p}`);
    for (const w of r.inspection!.warnings) console.log(`  warning: ${w}`);
    if (state === "not set up") {
      if (!args.flags.has("--setup")) console.log("  to set it up now: saw projects add <path> --setup");
      else printReport(initProject(r.project!.path, { dryRun: false, force: false }).report, false);
    }
    return 0;
  }
  if (sub === "remove" && target) {
    if (!removeProject(target)) return fail(`${target} is not in the project list`);
    console.log(`removed ${target} from the list (the folder is untouched)`);
    return 0;
  }
  return fail("usage: saw projects list | add <path> [--setup] | remove <path>");
}

function modsCommand(args: Args): number {
  const [, sub, name] = args.positional;
  if (sub !== "check") return fail(USAGE);
  let hasClaude = false;
  try {
    hasClaude = Bun.spawnSync(["claude", "--version"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
  } catch {
    // Bun throws when the executable isn't on PATH.
  }
  if (!hasClaude) {
    console.log("saw mods check: claude CLI not found; skipped");
    return 0;
  }
  const results = checkMods(PLUGIN_ROOT, (cmd) => Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit" }).exitCode, name);
  if (results.length === 0) return fail(name ? `no mod named ${name}` : "no mods under mods/");
  for (const r of results) console.log(`${r.name.padEnd(16)} validate ${r.validate === 0 ? "ok" : "FAILED"}  test ${r.test === null ? "none" : r.test === 0 ? "ok" : "FAILED"}`);
  return results.every((r) => r.validate === 0 && (r.test ?? 0) === 0) ? 0 : 1;
}

function evalCommand(cwd: string, config: Table, args: Args): number {
  const e = config.evals as { baseline: string; max_token_increase: number; runs: number };
  const readSummary = (path: string): Summary => summarise(JSON.parse(readFileSync(path, "utf8")));
  const [, sub, a, b] = args.positional;
  try {
    if (sub === "compare" && a && b) return report(compare(readSummary(a), readSummary(b), e.max_token_increase));
    if (sub !== undefined) return fail(USAGE);
    const baseline = inside(PLUGIN_ROOT, e.baseline);
    if (!baseline) return fail("evals.baseline must be a path inside the plugin");
    const runs = args.values.runs ? Number(args.values.runs) : e.runs;
    if (!Number.isInteger(runs) || runs < 1) return fail("--runs must be a whole number of at least 1");
    const out = join(cwd, ".saw", "evals", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    // No ablation arm: before/after compares two versions of the plugin, not plugin vs none (--ab adds it).
    const cmd = ["claude", "plugin", "eval", PLUGIN_ROOT, "--no-publish", "--ablation", args.flags.has("--ab") ? "with-without" : "none", "--runs", String(runs), "--threshold", "0", "--json", out];
    if (args.values.case) cmd.push("--case", args.values.case);
    // A paid run: say how big it is first.
    const cases = readdirSync(join(PLUGIN_ROOT, "evals"), { withFileTypes: true }).filter((d) => d.isDirectory() && (!args.values.case || new Bun.Glob(args.values.case).match(d.name))).length;
    const arms = args.flags.has("--ab") ? 2 : 1; // --ab adds the no-plugin arm
    console.log(`saw eval: ${cases} case(s) x ${runs} run(s)${arms > 1 ? " x 2 arms" : ""} = ${cases * runs * arms} agent sessions (paid)`);
    console.log(`  ${cmd.join(" ")}`);
    if (args.flags.has("--ab")) {
      if (args.flags.has("--save-baseline")) return fail("--ab and --save-baseline don't combine: save a baseline with a plain saw eval");
      console.log("  --ab: --ablation with-without, so each case also runs with no plugin loaded (saw off)");
      if (args.flags.has("--dry-run")) return 0;
      const dir = join(cwd, ".saw");
      mkdirSync(dir, { recursive: true });
      const runner: EvalRunner = (path) => {
        const c = cmd.map((x) => (x === out ? path : x));
        return Bun.spawnSync(c, { cwd, stdout: "inherit", stderr: "inherit" }).exitCode ?? 1;
      };
      const r = runAb(dir, runner, e.max_token_increase, (p) => JSON.parse(readFileSync(p, "utf8")), (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + "\n"));
      console.log(formatAb(r));
      console.log(`  -> ${join(dir, "evals-ab.json")}`);
      return 0;
    }
    if (args.flags.has("--dry-run")) return 0;
    mkdirSync(join(out, ".."), { recursive: true });
    const run = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
    if (!existsSync(out)) return fail(`claude plugin eval wrote no result (exit ${run.exitCode})`);
    // --threshold 0 means a non-zero exit is an error or a partial run (exit 2: cost ceiling), never a low score.
    if (run.exitCode !== 0) return fail(`claude plugin eval exited ${run.exitCode}; partial results in ${out} are not compared or saved`);
    const now = readSummary(out);
    console.log(`  ${Object.keys(now).length} cases -> ${out}`);
    if (args.flags.has("--save-baseline")) {
      writeFileSync(baseline, JSON.stringify(now, null, 2) + "\n");
      console.log(`  baseline -> ${baseline}`);
      return run.exitCode === 0 ? 0 : 1;
    }
    if (!existsSync(baseline)) {
      console.log("  no baseline yet; save one with saw eval --save-baseline before changing a skill or prompt");
      return run.exitCode === 0 ? 0 : 1;
    }
    return report(compare(JSON.parse(readFileSync(baseline, "utf8")) as Summary, now, e.max_token_increase));
  } catch (err) {
    return fail((err as Error).message);
  }
}

function report(c: Comparison): number {
  for (const r of c.regressions) console.log(`  worse   ${r}`);
  for (const i of c.improvements) console.log(`  better  ${i}`);
  for (const m of c.missing) console.log(`  missing ${m} (not in this run)`);
  console.log(c.regressions.length ? "saw eval: regression, don't promote this change" : "saw eval: no regressions");
  return c.regressions.length ? 1 : 0;
}

// saw doctor --hooks: runs each plugin hook entry in hooks/hooks.json once, in an empty
// temporary folder (not a saw project, so nothing is written) with a harmless Read payload,
// and prints its time in milliseconds. A hook that crashes would otherwise fail silently.
function checkHooks(_cwd: string): string[] {
  const hooks = JSON.parse(readFileSync(join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf8")) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
  const problems: string[] = [];
  const scratch = mkdtempSync(join(tmpdir(), "saw-doctor-hooks-"));
  try {
    for (const [event, groups] of Object.entries(hooks.hooks)) {
      for (const h of groups.flatMap((g) => g.hooks)) {
        const file = /hooks\/run\/([\w-]+)\.ts/.exec(h.command)?.[1];
        if (!file) continue;
        const payload = JSON.stringify({ hook_event_name: event, cwd: scratch, tool_name: "Read", tool_input: { file_path: join(scratch, "README.md") }, stop_hook_active: true, prompt: "" });
        const started = performance.now();
        const proc = Bun.spawnSync(["bun", "--no-install", join(PLUGIN_ROOT, "hooks", "run", `${file}.ts`)], { cwd: scratch, stdin: Buffer.from(payload), stdout: "pipe", stderr: "pipe", timeout: 15000, env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT } });
        const ms = Math.round(performance.now() - started);
        const ok = proc.exitCode === 0;
        const why = proc.exitCode === null ? "timed out after 15 s" : `exited ${proc.exitCode}`;
        console.log(`  hook ${event.padEnd(18)} ${file.padEnd(14)} ${String(ms).padStart(5)} ms ${ok ? "ok" : why}`);
        if (!ok) problems.push(`hook ${event} (${file}) ${why}: ${proc.stderr.toString().trim().split("\n").pop()}`);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return problems;
}

// saw doctor: the CLI can be fine while Claude Code never loads the plugin
// (bootstrap skips the install when `claude` isn't on PATH), so no hook runs.
export function pluginProblem(listOutput: string): string | undefined {
  const block = /sams-agentic-workflow@\S+[^]*?(?=\n\s*❯|$)/.exec(listOutput)?.[0];
  if (!block) return "Claude Code plugin sams-agentic-workflow is not installed: rerun the bootstrap with `claude` on PATH, or `claude plugin install sams-agentic-workflow@sams-agentic-workflow`";
  if (/disabled/i.test(block)) return "Claude Code plugin sams-agentic-workflow is installed but disabled: `claude plugin enable sams-agentic-workflow@sams-agentic-workflow`";
  return undefined;
}

// features.docs_step on: the docs step runs engineering:documentation, so that
// plugin (a dependency of saw's) must be installed and enabled too.
export function docsPluginProblem(listOutput: string, config: Table): string | undefined {
  if (!(config.features as Record<string, boolean>).docs_step) return undefined;
  const block = /engineering@\S+[^]*?(?=\n\s*❯|$)/.exec(listOutput)?.[0];
  if (block && !/disabled/i.test(block)) return undefined;
  return `features.docs_step is on but the engineering plugin is ${block ? "disabled" : "not installed"} (it provides engineering:documentation): \`claude plugin ${block ? "enable" : "install"} engineering@sams-agentic-workflow\`, or set features.docs_step false`;
}

function modNames(): string[] {
  const dir = join(PLUGIN_ROOT, "mods");
  return existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(join(dir, d, ".claude-plugin", "plugin.json"))) : [];
}

// saw doctor: each saw mod installed and enabled, and whether this host draws
// them. Mods that render (panes, bands, buttons) only show in the terminal TUI.
export function modsReport(listOutput: string, mods: string[], entrypoint: string | undefined): { lines: string[]; problems: string[] } {
  const lines: string[] = [];
  const problems: string[] = [];
  for (const m of mods) {
    const block = new RegExp(`(?:^|\\s)${m}@sams-agentic-workflow[^]*?(?=\\n\\s*❯|$)`).exec(listOutput)?.[0];
    const state = !block ? "not installed" : /disabled/i.test(block) ? "disabled" : "enabled";
    // Most mods are optional: one not installed is a note. A default mod missing, or any mod disabled, is a problem.
    const isDefault = DEFAULT_MODS.includes(m);
    lines.push(`mod ${m.padEnd(18)} ${state}${state === "not installed" && !isDefault ? ` (optional: claude plugin install ${m}@sams-agentic-workflow)` : ""}`);
    if (state === "not installed" && isDefault) problems.push(`mod ${m} is installed by default but missing: \`claude plugin install ${m}@sams-agentic-workflow\``);
    if (state === "disabled") problems.push(`mod ${m} is disabled: \`claude plugin enable ${m}@sams-agentic-workflow\``);
  }
  if (mods.length && entrypoint && entrypoint !== "cli") lines.push(`host ${entrypoint}: mod panes, bands and buttons draw only in the terminal \`claude\`; run it there to see them`);
  return { lines, problems };
}

function checkPlugin(config: Table): string[] {
  if (!Bun.which("claude")) {
    console.log("  plugin: skipped (claude not on PATH)");
    return [];
  }
  const proc = Bun.spawnSync(["claude", "plugin", "list"], { stdout: "pipe", stderr: "pipe" });
  const out = proc.stdout.toString();
  const problem = proc.exitCode === 0 ? pluginProblem(out) ?? docsPluginProblem(out, config) : `\`claude plugin list\` exited ${proc.exitCode}`;
  if (problem) console.error(`problem: ${problem}`);
  else console.log("  plugin: ok");
  const mods = proc.exitCode === 0 ? modsReport(out, modNames(), process.env.CLAUDE_CODE_ENTRYPOINT) : { lines: [], problems: [] };
  for (const l of mods.lines) console.log(`  ${l}`);
  for (const m of mods.problems) console.error(`problem: ${m}`);
  return [...(problem ? [problem] : []), ...mods.problems];
}

// run() returns this when a server is running: the entrypoint must not exit.
export const SERVING = -1;

// saw dashboard --serve: the live page, in dashboard-server.ts.
export { serveDashboard } from "./dashboard-server";

function fail(message: string): number {
  console.error(`saw: ${message}`);
  return 1;
}

if (import.meta.main) {
  const code = run(process.argv.slice(2));
  if (code !== SERVING) process.exit(code);
}
