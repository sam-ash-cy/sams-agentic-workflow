// saw: the sams-agentic-workflow CLI.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { flatten, layerPaths, parseValue, resolve, setPath, unsetPath, validate, weakenedSafety, type Layer } from "./config";
import type { Table, Value } from "./defaults";
import { syncAgents } from "./agents";
import { AGENTS, checkAdapters, installAdapters } from "./adapters";
import { syncVault, vaultPath } from "./vault";
import { contextHook } from "./context";
import { effectiveStyle, styleCheck, styleLine, TONES } from "./style";
import { renderHtml, renderMarkdown } from "./dashboard";
import { appendMetric, buildMetric, readMetrics } from "./metrics";
import { compare, summarise, type Comparison, type Summary } from "./evals";
import { readProposals, retro } from "./retro";
import { compareUrl, pin, readLock, verifyLock } from "./deps";
import { init, type InitReport } from "./init";
import { lintContext } from "./lint";
import { runCheck } from "./run";
import { currentTask, endTask, gate, recordCheck, startTask, taskStatus } from "./task";
import { readToml, stringifyToml } from "./toml";

const USAGE = `usage: saw <command>
  config show [--resolved]           resolved settings (with the layer each came from)
  config get <key>
  config set <key> <value> [--scope global|project|local]   (default: project)
  config unset <key> [--scope ...]
  doctor                             check settings and environment
  init [--dry-run] [--force] [--type <t>] [--hooks] [--agents a,b]   add workflow.toml, AGENTS.md, CI and the docs/ vault (+ agent adapters)
  agents check                       smoke test: will each agent in agents.enabled read AGENTS.md?
  vault sync [--dry-run]             index this project (and its learnings) in the central vault
  sync [--plugin-dir <dir>] [--dry-run]   write .saw/resolved.json; set agent models from [models]
  deps list | verify [--strict]      pinned third-party skills (deps.lock.toml)
  deps diff <name> <sha>             compare URL to review before updating a pin
  deps pin <name> <sha> --reviewed-by <who>
  task start --tier <t> --playbook <p> [--tone <t>] [--max-words <n>]   open a task (the router does this)
  task status                        report label + which required checks passed, failed or are missing
  task record <check> pass|fail [--note "..."]   record a judgement check (code_review, ...)
  task end [--tokens <n>]            close the task and append its metrics (.saw/metrics.jsonl)
  dashboard                          write the static metrics page (and the Obsidian note if set)
  retro [--dry-run]                  write a proposal for each check failing in repeat_threshold+ tasks
  eval [--case <glob>] [--save-baseline]   run the eval suite (claude plugin eval) and compare with the baseline
  eval compare <before.json> <after.json>  compare two saved eval results
  run <check>                        run checks.<check> quietly and record the result
  gate                               Stop hook: block "done" until the tier's checks pass
  lint-context                       AGENTS.md / CLAUDE.md size limits
  context                            UserPromptSubmit hook: suggest /compact as context fills
  style                              the effective reply style for this task (tone, word cap)
  style-check                        Stop hook: warn (soft) or ask for a rewrite (hard) when a reply is over the cap
global flag: --set key=value         per-task override (repeatable)`;

interface Args {
  positional: string[];
  flags: Set<string>;
  scope: Exclude<Layer, "default" | "override">;
  overrides: Record<string, Value>;
  values: Record<string, string>;
}

const VALUE_FLAGS = ["--tier", "--playbook", "--note", "--plugin-dir", "--reviewed-by", "--type", "--tokens", "--case", "--agents", "--tone", "--max-words"];
const PLUGIN_ROOT = join(import.meta.dir, "..", "..");

function parseArgs(argv: string[]): Args {
  const args: Args = { positional: [], flags: new Set(), scope: "project", overrides: {}, values: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--scope") args.scope = argv[++i] as Args["scope"];
    else if (a === "--set") {
      const [key, ...rest] = (argv[++i] ?? "").split("=");
      args.overrides[key!] = parseValue(rest.join("="));
    } else if (VALUE_FLAGS.includes(a)) args.values[a.slice(2)] = argv[++i] ?? "";
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

export function run(argv: string[], cwd = process.cwd()): number {
  const args = parseArgs(argv);
  const [command, sub, key, raw] = args.positional;
  const resolved = resolve(cwd, args.overrides);
  for (const w of resolved.warnings) console.error(`warning: ${w}`);

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
    if (!(key in flat)) return fail(`unknown key "${key}"`);
    console.log(JSON.stringify(flat[key]));
    return 0;
  }
  if (command === "config" && (sub === "set" || sub === "unset") && key) {
    const path = layerPaths(cwd)[args.scope];
    if (!path) return fail(`--scope must be global, project or local`);
    const table: Table = readToml(path) ?? {};
    if (sub === "set") {
      if (raw === undefined) return fail(USAGE);
      const value = parseValue(raw);
      const problem = validate(key, value);
      if (problem) return fail(problem);
      if (args.scope === "project" && key.startsWith("safety.")) {
        console.error(`warning: a committed workflow.toml can only tighten ${key}; weakening it there is ignored`);
      }
      setPath(table, key, value);
    } else if (!unsetPath(table, key)) {
      return fail(`${key} is not set in ${path}`);
    }
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, stringifyToml(table));
    console.log(`${sub === "set" ? "set" : "unset"} ${key} in ${path}`);
    return 0;
  }
  if (command === "doctor") {
    const weakened = weakenedSafety(resolved);
    for (const w of weakened) console.log(`weakened guardrail: ${w}`);
    const problems = [...resolved.warnings, ...lintContext(cwd, resolved.config)];
    for (const p of lintContext(cwd, resolved.config)) console.error(`warning: ${p}`);
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
    const report = init(cwd, { dryRun, force: args.flags.has("--force") });
    if (type && !report.installed.includes("workflow.toml")) {
      console.error(`warning: workflow.toml already exists, so --type was not applied; run: saw config set project.type ${type}`);
    } else if (type && !dryRun) {
      const path = join(cwd, "workflow.toml");
      writeFileSync(path, readFileSync(path, "utf8").replace(/^type = "\w+"/m, `type = "${type}"`));
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
    }
    return 0;
  }
  if (command === "sync") {
    mkdirSync(join(cwd, ".saw"), { recursive: true });
    writeFileSync(join(cwd, ".saw", "resolved.json"), JSON.stringify(resolved.config, null, 2) + "\n");
    console.log("saw sync: wrote .saw/resolved.json");
    const dryRun = args.flags.has("--dry-run");
    for (const a of syncAgents(args.values["plugin-dir"] ?? PLUGIN_ROOT, resolved.config, dryRun)) {
      console.log(`  agent ${a.name.padEnd(18)} model: ${a.model}${a.changed ? (dryRun ? " (would change)" : " (changed)") : ""}`);
    }
    const models = resolved.config.models as { mode?: string; strong?: string };
    if (models.mode === "single") console.log(`  single-model mode: agents inherit; to pin one model for all subagents set CLAUDE_CODE_SUBAGENT_MODEL=${models.strong}`);
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
    const k = resolved.config.knowledge as { store: string; vault_path: string };
    const v = vaultPath(k.vault_path, resolved.sources["knowledge.vault_path"]);
    if (!v.path) return fail(v.error!);
    const dryRun = args.flags.has("--dry-run");
    const r = syncVault(v.path, cwd, k.store, readMetrics(cwd), dryRun);
    for (const w of r.warnings) console.error(`warning: ${w}`);
    console.log(`saw vault sync${dryRun ? " (dry run)" : ""}: ${r.note}${r.copied.length ? `, ${r.copied.length} learnings` : ""}`);
    return 0;
  }
  if (command === "deps") return depsCommand(cwd, resolved.config, args);
  if (command === "dashboard") {
    const d = resolved.config.dashboard as { panels: string[]; output: string; obsidian_note: string };
    const metrics = readMetrics(cwd);
    const out = inside(cwd, d.output);
    const note = d.obsidian_note ? inside(cwd, d.obsidian_note) : undefined;
    if (!out || (d.obsidian_note && !note)) return fail("dashboard.output and dashboard.obsidian_note must be paths inside the project");
    const proposalsDir = inside(cwd, (resolved.config.retro as { proposals_dir: string }).proposals_dir);
    const proposals = proposalsDir ? readProposals(proposalsDir) : [];
    mkdirSync(join(out, ".."), { recursive: true });
    writeFileSync(out, renderHtml(metrics, d.panels, proposals));
    console.log(`saw dashboard: ${metrics.length} tasks -> ${out}`);
    if (note) {
      mkdirSync(join(note, ".."), { recursive: true });
      writeFileSync(note, renderMarkdown(metrics, d.panels, proposals));
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
    return 0;
  }
  if (command === "eval") return evalCommand(cwd, resolved.config, args);
  if (command === "task") return taskCommand(cwd, resolved.config, args);
  if (command === "run" && sub) {
    try {
      const r = runCheck(cwd, resolved.config, sub);
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
    return 0;
  }
  if (command === "context") {
    let input = {};
    try {
      input = JSON.parse(readFileSync(0, "utf8") || "{}");
    } catch {
      // No hook payload: nothing to measure.
    }
    const out = contextHook(cwd, resolved.config, input);
    if (out) console.log(JSON.stringify(out));
    return 0;
  }
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

function taskCommand(cwd: string, config: Table, args: Args): number {
  const [, sub, name, status] = args.positional;
  try {
    if (sub === "start") {
      const tone = args.values.tone;
      if (tone !== undefined && !(TONES as readonly string[]).includes(tone)) return fail(`--tone must be one of ${TONES.join(" | ")}`);
      const rawCap = args.values["max-words"];
      if (rawCap !== undefined && !/^[1-9]\d*$/.test(rawCap)) return fail("--max-words must be a positive whole number");
      const t = startTask(cwd, args.values.tier ?? "", args.values.playbook ?? "feature", {
        tone,
        max_words: rawCap === undefined ? undefined : Number(rawCap),
      });
      console.log(`task: ${t.tier} / ${t.playbook} · ${styleLine(effectiveStyle(config, t))}`);
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
      endTask(cwd);
      return 0;
    }
    const task = currentTask(cwd);
    if (!task) return fail("no open task; start one with saw task start --tier <t> --playbook <p>");
    if (sub === "record" && name && (status === "pass" || status === "fail")) {
      recordCheck(cwd, { name, status, how: "recorded", note: args.values.note });
      console.log(`recorded ${name}: ${status}`);
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
      pin(lockPath, name, sha, args.values["reviewed-by"] ?? "");
      console.log(`pinned ${name} at ${sha.slice(0, 12)}`);
      return 0;
    }
  } catch (e) {
    return fail((e as Error).message);
  }
  return fail(USAGE);
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
    const out = join(cwd, ".saw", "evals", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    mkdirSync(join(out, ".."), { recursive: true });
    // No ablation arm: before/after compares two versions of the plugin, not plugin vs none.
    const cmd = ["claude", "plugin", "eval", PLUGIN_ROOT, "--no-publish", "--ablation", "none", "--runs", String(e.runs), "--threshold", "0", "--json", out];
    if (args.values.case) cmd.push("--case", args.values.case);
    console.log(`saw eval: ${cmd.join(" ")}`);
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

// Resolves a configured path, or undefined if it escapes the project (a
// committed workflow.toml must not be able to write elsewhere).
function inside(cwd: string, path: string): string | undefined {
  const full = resolvePath(cwd, path);
  const rel = relative(resolvePath(cwd), full);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? full : undefined;
}

function fail(message: string): number {
  console.error(`saw: ${message}`);
  return 1;
}

if (import.meta.main) process.exit(run(process.argv.slice(2)));
