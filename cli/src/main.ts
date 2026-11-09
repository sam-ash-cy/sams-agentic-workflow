// saw: the sams-agentic-workflow CLI.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { baseBranch, flatten, inside, layerPaths, layerValues, loosens, parseValue, resolve, setPath, unsetPath, validate, weakenedSafety, type Layer } from "./config";
import { DEFAULTS, type Table, type Value } from "./defaults";
import { readIfExists } from "./fs";
import { syncAgents, syncSession } from "./agents";
import { AGENTS, checkAdapters, installAdapters } from "./adapters";
import { syncVault, vaultPath } from "./vault";
import { budgetHook, contextHook, routerNudge } from "./context";
import { planModelWarning } from "./model-guard";
import { guardHook } from "./guard";
import { sessionHook, UNITS } from "./sessions";
import { recordReview, reviewApplies, reviewArgv, reviewBrief, writeChange, type ReviewSettings } from "./review-session";
import { effectiveStyle, styleCheck, styleLine, TONES } from "./style";
import { autopilot, eligible, parseQueue, readRuns, readState as autopilotState, scheduleCommand, settings as autopilotSettings, spawnClaude, stopReasons } from "./autopilot";
import { dataVersion, renderHtml, renderMarkdown } from "./dashboard";
import { logEvent, readEvents } from "./events";
import { appendMetric, buildMetric, readMetrics } from "./metrics";
import { compare, summarise, type Comparison, type Summary } from "./evals";
import { configSuggestions, readProposals, retro } from "./retro";
import { compareUrl, eccProblem, gateguardWarning, pin, readLock, verifyLock } from "./deps";
import { depAuditFor, guessType, init, recordInstalled, uninstall, upgrade, type ChangeReport, type InitReport } from "./init";
import { lintContext, lintMemory } from "./lint";
import { docsNudge, docsStatus, REFRESH_BRIEF } from "./docs";
import { outline } from "./outline";
import { sanitize, sanitizeHistory } from "./sanitize";
import { syncSkillDenies } from "./skills";
import { applyPlan, gh, readState, repoName, repoPlan, type Gh } from "./repo";
import { formatHook, runCheck, TRUSTED_LAYERS } from "./run";
import { checkMods } from "./mods";
import { currentTask, endTask, gate, markUntaskedEdit, pickTier, recordCheck, reviewEvidence, setPhase, startTask, taskReport, taskStatus, taskSteps } from "./task";
import { patchToml, readToml, stringifyToml } from "./toml";
import { applyProfile, parseProfiles } from "./profiles";
import { aboutHook, aboutPaths, createAbout, type AboutScope } from "./about-me";
import { catalog, changedFiles, figmaFallback, findSkills, installedNames, installSteps, isInstalled, offer, readState as readRecommendState, recommendHook, writeState } from "./recommend";

const USAGE = `usage: saw <command>
  config show [--resolved] [--layers [--json]]   resolved settings (with the layer each came from); --layers: every key in every layer
  docs status [--json] | refresh     which project docs are still the blank template; refresh prints the fill-from-code brief
  config get <key>
  config set <key> <value> [--scope global|project|local]   (default: project)
  config unset <key> [--scope ...]
  explain <key>                      the value in every layer, which one won, and why one was ignored
  profile list | show <name> | apply <name> [--dry-run]   merge a recommended profile (docs/COMMANDS.md) into the layers it names
  doctor [--hooks] [--no-plugin]     check settings, environment and the Claude Code plugin install (--hooks: run each plugin hook once)
  init [--dry-run] [--force] [--type <t>] [--hooks] [--agents a,b] [--repo [o/n]]   add workflow.toml, AGENTS.md, CI and the docs/ vault (+ agent adapters; --repo: show the repo plan)
  init --upgrade [--dry-run]         update unedited template files to the current template; edited ones are kept
  uninstall [--dry-run]              remove template files you haven't edited
  agents check                       smoke test: will each agent in agents.enabled read AGENTS.md?
  vault sync [--dry-run]             index this project (and its learnings) in the central vault
  sync [--plugin-dir <dir>] [--dry-run]   write .saw/resolved.json; set agent models from [models]; deny skills of disabled features
  deps list | verify [--strict]      pinned third-party skills (deps.lock.toml)
  deps diff <name> <sha>             compare URL to review before updating a pin
  deps pin <name> <sha> --reviewed-by <who>
  task start --tier <t> --playbook <p> [--tone <t>] [--max-words <n>] [--unit phase|stage|feature --unit-id <name>]   open a task (the router does this)
  task adhoc [--playbook <p>]        open a trivial task for a one-off edit (same as task start --tier trivial)
  task phase plan|implement|review  mark where the open task is (implement: the main session can't edit source when features.implementer is on)
  task status                        report label + which required checks passed, failed or are missing
  task record <check> pass|fail [--note "..."] [--report <file>]   record a judgement check (code_review, ...); --report: a reviewer's report under .saw/reviews/ (verify.require_review_evidence)
  task report [--post [--pr <n>] [--yes]]   Markdown verification section for a PR (--post: gh pr comment, per autonomy.actions.open_pr)
  repo plan|apply [--repo o/n] [--yes]   GitHub settings from [repo]: diff, then apply only with --yes and re-verify
  outline <file>                     signatures with line numbers (when Trail is off)
  task end [--tokens <n>]            close the task and append its metrics (.saw/metrics.jsonl)
  dashboard [--serve [--port <n>]]   write the static metrics page (and the Obsidian note if set); --serve: live page on 127.0.0.1
  retro [--dry-run]                  write a proposal for each check failing in repeat_threshold+ tasks
  eval [--case <glob>] [--runs <n>] [--dry-run] [--save-baseline]   run the eval suite (claude plugin eval) and compare with the baseline
  eval compare <before.json> <after.json>  compare two saved eval results
  mods check [<name>]                validate and test the mods under mods/ (needs the claude CLI)
  run <check> [--changed]            run checks.<check> quietly and record the result (--changed: only tests for changed files)
  gate                               Stop hook: block "done" until the tier's checks pass
  lint-context                       AGENTS.md / CLAUDE.md size limits
  memory lint                        stale file refs in docs/learnings and docs/decisions, duplicate learnings, size limits
  sanitize [--history]               before going public: secrets, home paths, emails and your own names in published files (--history: in every commit)
  context                            UserPromptSubmit hook: suggest /compact as context fills; warn on the task's token budget
  guard                              PreToolUse hook: enforce [safety] and [autonomy] on shell commands and file edits, models.roles on saw agent calls
  session-start                      SessionStart hook: warn when the session's model isn't models.roles.plan
  format-hook                        PostToolUse hook: run checks.format after each edit
  review-session brief|run [--dry-run]|record <file> --unit <kind> --unit-id <name>   independent read-only review of a unit ([review_session])
  autopilot [status] [--dry-run] [--once] [--install-schedule]   work through approved queue items, one headless session + branch each ([autopilot]; never merges)
  style                              the effective reply style for this task (tone, word cap)
  style-check                        Stop hook: warn (soft) or ask for a rewrite (hard) when a reply is over the cap
  about-me [show] [--scope global|project|local] [--dry-run]   create the about-me profile from the template (show: the merged summary sessions get)
  recommend list | add <id> [--scope global|project|local] [--dry-run] | dismiss <id>   suggested MCP servers and skills (recommendations.toml)
  skills find                        skills that fit the open task's changes (what saw task end suggests)
global flag: --set key=value         per-task override (repeatable)`;

interface Args {
  positional: string[];
  flags: Set<string>;
  scope: Exclude<Layer, "default" | "override">;
  // Whether --scope was given (saw recommend add then passes it on).
  scoped: boolean;
  overrides: Record<string, Value>;
  values: Record<string, string>;
}

const VALUE_FLAGS = ["--runs", "--repo", "--pr", "--tier", "--playbook", "--note", "--plugin-dir", "--reviewed-by", "--type", "--tokens", "--case", "--agents", "--tone", "--max-words", "--unit", "--unit-id", "--port", "--report"];
const PLUGIN_ROOT = join(import.meta.dir, "..", "..");

function parseArgs(argv: string[]): Args {
  const args: Args = { positional: [], flags: new Set(), scope: "project", scoped: false, overrides: {}, values: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--scope") {
      args.scope = argv[++i] as Args["scope"];
      args.scoped = true;
    }
    else if (a === "--set") {
      const [key, ...rest] = (argv[++i] ?? "").split("=");
      args.overrides[key!] = parseValue(rest.join("="));
    } else if (VALUE_FLAGS.includes(a)) {
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

const HOOKS = ["guard", "gate", "context", "format-hook", "session-hook", "style-check", "failure-hook", "session-start"];

export function run(argv: string[], cwd = process.cwd()): number {
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
  let resolved: ReturnType<typeof resolve>;
  try {
    resolved = resolve(cwd, args.overrides);
  } catch (e) {
    const problem = `settings unreadable (${(e as Error).message}); fix the TOML file`;
    if (!HOOKS.includes(command ?? "")) return fail(problem);
    // A hook that crashes lets the tool call through: fail closed instead.
    if (command === "guard") {
      let tool = "";
      try {
        tool = (JSON.parse(readFileSync(0, "utf8") || "{}") as { tool_name?: string }).tool_name ?? "";
      } catch {
        // No payload: treat it as a shell call.
      }
      // Edits still go through (asking), so the broken file can be fixed.
      const decision = tool === "Bash" || tool === "" ? "deny" : "ask";
      console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: `saw guard: ${problem}` } }));
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
    const text = readIfExists(path) ?? "";
    const table: Table = readToml(path) ?? {};
    let value: Value | undefined;
    if (sub === "set") {
      if (raw === undefined) return fail(USAGE);
      try {
        value = parseValue(raw);
      } catch (e) {
        return fail(`bad value for ${key}: ${(e as Error).message}`);
      }
      const problem = validate(key, value);
      if (problem) return fail(problem);
      if (args.scope === "project" && loosens(key, value)) {
        console.error(`warning: a committed workflow.toml can only tighten ${key}; weakening it there is ignored`);
      }
      setPath(table, key, value);
    } else if (!unsetPath(table, key)) {
      return fail(`${key} is not set in ${path}`);
    }
    mkdirSync(join(path, ".."), { recursive: true });
    // In place where possible, so the file's comments survive.
    writeFileSync(path, patchToml(text, key, value, table) ?? stringifyToml(table));
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
    const claudeDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
    const read = (p: string): string | undefined => (existsSync(p) ? readFileSync(p, "utf8") : undefined);
    // A recommendation, not a failure: GateGuard works, it just duplicates saw guard.
    const gg = gateguardWarning(read(join(claudeDir, "plugins", "installed_plugins.json")), read(join(claudeDir, "settings.json")), process.env.ECC_GATEGUARD);
    if (gg) console.error(`warning: ${gg}`);
    if (args.flags.has("--hooks")) problems.push(...checkHooks(cwd));
    if ((resolved.config.features as Record<string, boolean>).ecc) {
      const installed = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "plugins", "installed_plugins.json");
      const ecc = eccProblem(existsSync(installed) ? readFileSync(installed, "utf8") : undefined, readLock(join(PLUGIN_ROOT, "deps.lock.toml")).ecc?.sha);
      if (ecc) {
        console.error(`warning: ${ecc}`);
        problems.push(ecc);
      }
    }
    const ok = problems.length === 0;
    console.log(ok ? "saw doctor: ok" : `saw doctor: ${problems.length} problem(s)`);
    return ok ? 0 : 1;
  }
  if (command === "init") {
    const dryRun = args.flags.has("--dry-run");
    const type = args.values.type;
    if (type !== undefined) {
      const problem = validate("project.type", type);
      if (problem) return fail(problem);
    }
    if (args.flags.has("--upgrade")) return printChanges("saw init --upgrade", "updated", "kept (edited)", upgrade(cwd, { dryRun }), dryRun);
    const report = init(cwd, { dryRun, force: args.flags.has("--force") });
    const audit = depAuditFor(cwd);
    if (audit && report.installed.includes("workflow.toml")) {
      report.changed.push(`workflow.toml (checks.dep_audit = "${audit}")`);
      if (!dryRun) {
        appendFileSync(join(cwd, "workflow.toml"), `\n[checks]\ndep_audit = ${JSON.stringify(audit)}   # from the lockfiles found by saw init\n`);
        recordInstalled(cwd, "workflow.toml", readFileSync(join(cwd, "workflow.toml"), "utf8"));
      }
    }
    const guessed = type === undefined && report.installed.includes("workflow.toml") ? guessType(cwd) : undefined;
    if (guessed) console.log(`  project.type = "${guessed.type}" (guessed from ${guessed.from}; change it with saw config set project.type <t>)`);
    const chosen = type ?? guessed?.type;
    if (type && !report.installed.includes("workflow.toml")) {
      console.error(`warning: workflow.toml already exists, so --type was not applied; run: saw config set project.type ${type}`);
    } else if (chosen && !dryRun) {
      const path = join(cwd, "workflow.toml");
      writeFileSync(path, readFileSync(path, "utf8").replace(/^type = "\w+"/m, `type = "${chosen}"`));
      recordInstalled(cwd, "workflow.toml", readFileSync(path, "utf8"));
    }
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
    const models = resolved.config.models as { mode?: string; strong?: string };
    if (models.mode === "single") console.log(`  single-model mode: agents inherit; to pin one model for all subagents set CLAUDE_CODE_SUBAGENT_MODEL=${models.strong}`);
    try {
      const s = syncSkillDenies(cwd, resolved.config, dryRun);
      for (const e of s.added) console.log(`  deny ${e}${dryRun ? " (would add)" : ""} (feature off)`);
      for (const e of s.removed) console.log(`  allow ${e}${dryRun ? " (would remove deny)" : ""} (feature on)`);
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
      if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) return fail("--port must be a number from 1 to 65535");
      try {
        const server = serveDashboard(cwd, resolved.config, Number(raw));
        console.log(`saw dashboard: serving on http://127.0.0.1:${server.port}/ (Ctrl+C to stop)`);
      } catch (e) {
        return fail(`could not serve on port ${raw}: ${(e as Error).message}`);
      }
      return SERVING;
    }
    mkdirSync(join(out, ".."), { recursive: true });
    writeFileSync(out, renderHtml(metrics, d.panels, proposals, readRuns(cwd), new Date(), readEvents(cwd, d.events_limit)));
    console.log(`saw dashboard: ${metrics.length} tasks -> ${out}`);
    if (note) {
      mkdirSync(join(note, ".."), { recursive: true });
      writeFileSync(note, renderMarkdown(metrics, d.panels, proposals, readRuns(cwd)));
      console.log(`  note -> ${note}`);
    }
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
    const result = retro(dir, readMetrics(cwd), r.repeat_threshold, write);
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
  if (command === "task") return taskCommand(cwd, resolved.config, args);
  if (command === "run" && sub) {
    try {
      const r = runCheck(cwd, resolved.config, sub, { changed: args.flags.has("--changed") });
      logEvent(cwd, resolved.config, r.code === 0 ? "info" : "warn", "check", `saw run ${sub}: ${r.code === 0 ? "pass" : `fail (exit ${r.code})`}`, { check: sub, code: r.code });
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
      input = JSON.parse(readFileSync(0, "utf8") || "{}");
    } catch {
      // No hook payload (run by hand): treat as a fresh stop.
    }
    const block = gate(cwd, resolved.config, input);
    if (block) console.log(JSON.stringify(block));
    const tier = currentTask(cwd)?.tier;
    if (block) logEvent(cwd, resolved.config, "warn", "gate.block", block.reason, { tier });
    else if (tier) logEvent(cwd, resolved.config, "info", "gate.pass", `stop allowed (${tier})`, { tier });
    return 0;
  }
  if (command === "context") {
    let input = {};
    try {
      input = JSON.parse(readFileSync(0, "utf8") || "{}");
    } catch {
      // No hook payload: nothing to measure.
    }
    const budget = budgetHook(cwd, resolved.config, currentTask(cwd), input);
    if (budget) logEvent(cwd, resolved.config, "warn", "budget", String(budget.systemMessage));
    const nudge = routerNudge(cwd, resolved.config);
    if (nudge) logEvent(cwd, resolved.config, "debug", "nudge", "no saw task open: pointed the agent at the router skill");
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
  if (command === "session-start") {
    let input = {};
    try {
      input = JSON.parse(readFileSync(0, "utf8") || "{}");
    } catch {
      // No hook payload: no model to check.
    }
    const warning = planModelWarning(resolved.config, input);
    if (warning) logEvent(cwd, resolved.config, "warn", "model.plan", String(warning.systemMessage));
    const about = aboutHook(cwd, resolved.config.features as Record<string, boolean>);
    const context = [(warning?.hookSpecificOutput as { additionalContext?: string } | undefined)?.additionalContext, about].filter(Boolean).join("\n\n");
    if (context || warning) console.log(JSON.stringify({ systemMessage: warning?.systemMessage, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }));
    return 0;
  }
  // PostToolUseFailure: the agent sees the error, but nothing kept it. Log
  // which tool failed, on what, and the end of the error.
  if (command === "failure-hook") {
    let input: { tool_name?: string; tool_input?: { command?: unknown; file_path?: unknown }; error?: unknown; is_interrupt?: boolean } = {};
    try {
      input = JSON.parse(readFileSync(0, "utf8") || "{}");
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
    let input = {};
    try {
      input = JSON.parse(readFileSync(0, "utf8") || "{}");
    } catch {
      // No hook payload: nothing to check.
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
      markUntaskedEdit(cwd, typeof file === "string" ? file : undefined);
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
  if (command === "style") {
    console.log(styleLine(effectiveStyle(resolved.config, currentTask(cwd))));
    return 0;
  }
  if (command === "style-check") {
    let input = {};
    try {
      input = JSON.parse(readFileSync(0, "utf8") || "{}");
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
  const items = existsSync(queue) ? eligible(parseQueue(readFileSync(queue, "utf8")), state) : [];
  if (args.positional[1] === "status" || args.flags.has("--dry-run")) {
    console.log(`saw autopilot: ${items.length} approved item(s) left in ${s.queue}; spent $${state.spent_usd.toFixed(2)} of $${s.max_total_usd}`);
    for (const i of items) console.log(`  next  ${i.slug}${i.text ? `: ${i.text}` : ""}`);
    if (state.current) console.log(`  current ${state.current.slug} (${state.current.branch}, session ${state.current.session_id}${state.current.until ? `, waiting until ${state.current.until}` : ""})`);
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
      const t = startTask(cwd, pickTier(config, args.values.tier), playbook, {
        tone,
        max_words: rawCap === undefined ? undefined : Number(rawCap),
      });
      console.log(`task: ${t.tier} / ${t.playbook} · ${styleLine(effectiveStyle(config, t))}`);
      logEvent(cwd, config, "info", "tier", `${t.tier} / ${t.playbook}`, { tier: t.tier, playbook: t.playbook, requested: args.values.tier ?? null });
      console.log(`steps: ${taskSteps(config, t.tier, t.playbook).join(" · ")}`);
      return 0;
    }
    if (sub === "end") {
      const open = currentTask(cwd);
      const features = config.features as Record<string, boolean>;
      if (open && features.metrics) {
        const raw = args.values.tokens;
        const tokens = raw === undefined ? undefined : /^\d+$/.test(raw) ? Number(raw) : NaN;
        if (tokens !== undefined && Number.isNaN(tokens)) return fail("--tokens must be a whole number");
        const m = buildMetric(cwd, config, open, tokens);
        appendMetric(cwd, m);
        console.log(`task closed: ${m.label}${m.tokens !== undefined ? `, ${m.tokens} tokens (${m.tokens_source})` : ""}`);
      } else {
        console.log("task closed");
      }
      if (open && features.skill_finder) printSkillSuggestions(cwd, config, open.playbook);
      if (open && features.living_docs) for (const line of docsNudge(cwd, baseBranch(config))) console.log(line);
      endTask(cwd);
      return 0;
    }
    const task = currentTask(cwd);
    if (!task) return fail("no open task; start one with saw task start --tier <t> --playbook <p>");
    if (sub === "phase" && name) {
      setPhase(cwd, name);
      console.log(`phase: ${name}`);
      logEvent(cwd, config, "info", "phase", name, { tier: task.tier });
      return 0;
    }
    if (sub === "record" && name && (status === "pass" || status === "fail")) {
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
    if (sub === "status") {
      const s = taskStatus(cwd, config, task);
      console.log(`${task.tier} / ${task.playbook}: ${s.label}`);
      if (s.passed.length) console.log(`  passed  ${s.passed.join(", ")}`);
      if (s.failed.length) console.log(`  failed  ${s.failed.join(", ")}`);
      if (s.missing.length) console.log(`  not run ${s.missing.join(", ")}`);
      if (s.unconfigured.length) console.log(`  no command (set checks.<name>) ${s.unconfigured.join(", ")}`);
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
    // No ablation arm: before/after compares two versions of the plugin, not plugin vs none.
    const cmd = ["claude", "plugin", "eval", PLUGIN_ROOT, "--no-publish", "--ablation", "none", "--runs", String(runs), "--threshold", "0", "--json", out];
    if (args.values.case) cmd.push("--case", args.values.case);
    // A paid run: say how big it is first.
    const cases = readdirSync(join(PLUGIN_ROOT, "evals"), { withFileTypes: true }).filter((d) => d.isDirectory() && (!args.values.case || new Bun.Glob(args.values.case).match(d.name))).length;
    console.log(`saw eval: ${cases} case(s) x ${runs} run(s) = ${cases * runs} agent sessions (paid)`);
    console.log(`  ${cmd.join(" ")}`);
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

// saw doctor --hooks: runs each plugin hook's saw subcommand with an empty
// payload; a hook that crashes would otherwise fail silently in a session.
function checkHooks(cwd: string): string[] {
  const hooks = JSON.parse(readFileSync(join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf8")) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
  const problems: string[] = [];
  for (const [event, groups] of Object.entries(hooks.hooks)) {
    for (const h of groups.flatMap((g) => g.hooks)) {
      const sub = /bin\/saw"?\s+(\S+)/.exec(h.command)?.[1];
      if (!sub) continue;
      const proc = Bun.spawnSync(["bun", join(import.meta.dir, "main.ts"), sub], { cwd, stdin: Buffer.from("{}"), stdout: "pipe", stderr: "pipe" });
      const ok = proc.exitCode === 0;
      console.log(`  hook ${event.padEnd(16)} saw ${sub.padEnd(12)} ${ok ? "ok" : `exit ${proc.exitCode}`}`);
      if (!ok) problems.push(`hook ${event} (saw ${sub}) exited ${proc.exitCode}: ${proc.stderr.toString().trim().split("\n").pop()}`);
    }
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
  return problem ? [problem] : [];
}

// run() returns this when a server is running: the entrypoint must not exit.
export const SERVING = -1;

// saw dashboard --serve: renders on every request so the page is always current.
// Listens on 127.0.0.1 only. Inside the optional container (SAW_DASHBOARD_IN_CONTAINER=1
// and /.dockerenv present) it binds 0.0.0.0; compose publishes it on 127.0.0.1 only.
export function serveDashboard(cwd: string, config: Table, port: number): ReturnType<typeof Bun.serve> {
  const inContainer = process.env.SAW_DASHBOARD_IN_CONTAINER === "1" && existsSync("/.dockerenv");
  const d = config.dashboard as { panels: string[]; events_limit: number };
  const proposalsDir = inside(cwd, (config.retro as { proposals_dir: string }).proposals_dir);
  const headers = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
  };
  return Bun.serve({
    hostname: inContainer ? "0.0.0.0" : "127.0.0.1",
    port,
    fetch(req) {
      // DNS rebinding: only answer requests addressed to a loopback name.
      const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
      if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) return new Response("forbidden", { status: 403, headers });
      if (req.method !== "GET") return new Response("method not allowed", { status: 405, headers });
      const path = new URL(req.url).pathname;
      if (path === "/version") return new Response(dataVersion(cwd), { headers: { ...headers, "content-type": "text/plain" } });
      if (path !== "/") return new Response("not found", { status: 404, headers });
      const html = renderHtml(readMetrics(cwd), d.panels, proposalsDir ? readProposals(proposalsDir) : [], readRuns(cwd), new Date(), readEvents(cwd, d.events_limit), true);
      return new Response(html, { headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
    },
  });
}

function fail(message: string): number {
  console.error(`saw: ${message}`);
  return 1;
}

if (import.meta.main) {
  const code = run(process.argv.slice(2));
  if (code !== SERVING) process.exit(code);
}
