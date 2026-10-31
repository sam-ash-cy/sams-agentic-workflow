// saw: the sams-agentic-workflow CLI.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { flatten, layerPaths, parseValue, resolve, setPath, unsetPath, validate, weakenedSafety, type Layer } from "./config";
import type { Table, Value } from "./defaults";
import { init, type InitReport } from "./init";
import { readToml, stringifyToml } from "./toml";

const USAGE = `usage: saw <command>
  config show [--resolved]           resolved settings (with the layer each came from)
  config get <key>
  config set <key> <value> [--scope global|project|local]   (default: project)
  config unset <key> [--scope ...]
  doctor                             check settings and environment
  init [--dry-run] [--force]         add workflow.toml and the docs/ vault
  sync                               write .saw/resolved.json from the resolved settings
global flag: --set key=value         per-task override (repeatable)`;

interface Args {
  positional: string[];
  flags: Set<string>;
  scope: Exclude<Layer, "default" | "override">;
  overrides: Record<string, Value>;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { positional: [], flags: new Set(), scope: "project", overrides: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--scope") args.scope = argv[++i] as Args["scope"];
    else if (a === "--set") {
      const [key, ...rest] = (argv[++i] ?? "").split("=");
      args.overrides[key!] = parseValue(rest.join("="));
    } else if (a.startsWith("--")) args.flags.add(a);
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
    const ok = resolved.warnings.length === 0;
    console.log(ok ? "saw doctor: ok" : `saw doctor: ${resolved.warnings.length} problem(s)`);
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
  console.log(USAGE);
  return command === undefined || command === "help" ? 0 : 1;
}

function fail(message: string): number {
  console.error(`saw: ${message}`);
  return 1;
}

if (import.meta.main) process.exit(run(process.argv.slice(2)));
