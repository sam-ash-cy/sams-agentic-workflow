// saw: the sams-agentic-workflow CLI.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { flatten, layerPaths, parseValue, resolve, setPath, unsetPath, validate, weakenedSafety, type Layer } from "./config";
import type { Table, Value } from "./defaults";
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
  init [--dry-run] [--force]         add workflow.toml and the docs/ vault
  sync                               write .saw/resolved.json from the resolved settings
  task start --tier <t> --playbook <p>   open a task (the router does this)
  task status                        report label + which required checks passed, failed or are missing
  task record <check> pass|fail [--note "..."]   record a judgement check (code_review, ...)
  task end                           close the task
  run <check>                        run checks.<check> quietly and record the result
  gate                               Stop hook: block "done" until the tier's checks pass
  lint-context                       AGENTS.md / CLAUDE.md size limits
global flag: --set key=value         per-task override (repeatable)`;

interface Args {
  positional: string[];
  flags: Set<string>;
  scope: Exclude<Layer, "default" | "override">;
  overrides: Record<string, Value>;
  values: Record<string, string>;
}

const VALUE_FLAGS = ["--tier", "--playbook", "--note"];

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
    printReport(init(cwd, { dryRun, force: args.flags.has("--force") }), dryRun);
    return 0;
  }
  if (command === "sync") {
    mkdirSync(join(cwd, ".saw"), { recursive: true });
    writeFileSync(join(cwd, ".saw", "resolved.json"), JSON.stringify(resolved.config, null, 2) + "\n");
    console.log("saw sync: wrote .saw/resolved.json");
    return 0;
  }
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
      const t = startTask(cwd, args.values.tier ?? "", args.values.playbook ?? "feature");
      console.log(`task: ${t.tier} / ${t.playbook}`);
      return 0;
    }
    if (sub === "end") {
      endTask(cwd);
      console.log("task closed");
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
      return 0;
    }
  } catch (e) {
    return fail((e as Error).message);
  }
  return fail(USAGE);
}

function fail(message: string): number {
  console.error(`saw: ${message}`);
  return 1;
}

if (import.meta.main) process.exit(run(process.argv.slice(2)));
