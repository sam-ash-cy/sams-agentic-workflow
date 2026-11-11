// `saw eval`: runs the eval suite with `claude plugin eval` and compares it
// with a saved baseline. A change passes only if no case scores lower, and no
// case at the same score costs more than evals.max_token_increase extra tokens.
// The result JSON isn't a documented contract, so `summarise` reads it
// tolerantly: any array of objects with a case name and a score.

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface CaseSummary {
  score: number;
  tokens?: number;
  cost?: number;
}

export type Summary = Record<string, CaseSummary>;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function caseOf(o: Record<string, unknown>): [string, CaseSummary] | undefined {
  const name = [o.name, o.case, o.case_name, o.id].find((v) => typeof v === "string") as string | undefined;
  const score = num(o.score) ?? num(o.mean_score) ?? num(o.pass_rate);
  if (!name || score === undefined) return undefined;
  const usage = (o.usage ?? {}) as Record<string, unknown>;
  const tokens = num(o.tokens) ?? num(o.mean_tokens) ?? num(o.total_tokens) ?? num(usage.total_tokens);
  const cost = num(o.cost_usd) ?? num(o.cost) ?? num(o.total_cost_usd) ?? num(usage.cost_usd);
  return [name, { score, ...(tokens !== undefined ? { tokens } : {}), ...(cost !== undefined ? { cost } : {}) }];
}

export function summarise(result: unknown): Summary {
  const out: Summary = {};
  const walk = (v: unknown, depth: number): void => {
    if (depth > 4 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const item of v) {
        const c = item && typeof item === "object" && !Array.isArray(item) ? caseOf(item as Record<string, unknown>) : undefined;
        if (c && !(c[0] in out)) out[c[0]] = c[1];
        else walk(item, depth + 1);
      }
      return;
    }
    for (const child of Object.values(v)) walk(child, depth + 1);
  };
  walk(result, 0);
  return out;
}

export interface Comparison {
  regressions: string[];
  improvements: string[];
  missing: string[];
}

export function compare(before: Summary, after: Summary, maxTokenIncrease: number): Comparison {
  const c: Comparison = { regressions: [], improvements: [], missing: [] };
  for (const [name, b] of Object.entries(before)) {
    const a = after[name];
    if (!a) {
      c.missing.push(name);
      continue;
    }
    if (a.score < b.score) c.regressions.push(`${name}: score ${b.score.toFixed(2)} -> ${a.score.toFixed(2)}`);
    else if (a.score > b.score) c.improvements.push(`${name}: score ${b.score.toFixed(2)} -> ${a.score.toFixed(2)}`);
    else if (a.tokens !== undefined && b.tokens) {
      const rise = (a.tokens - b.tokens) / b.tokens;
      if (rise > maxTokenIncrease) c.regressions.push(`${name}: tokens +${Math.round(rise * 100)}% at the same score`);
    }
  }
  return c;
}

// `saw eval --ab`: the same suite with saw's hooks on and off
// (SAW_DISABLE_HOOKS=1, honoured by every entry in hooks/run). Per case: pass
// rate (score), tokens and cost for each arm, and the difference.
export interface AbRow {
  case: string;
  on?: CaseSummary;
  off?: CaseSummary;
  delta: { score?: number; tokens?: number; cost?: number };
}

export interface AbResult {
  rows: AbRow[];
  totals: AbRow;
  comparison: Comparison; // "off" as before, "on" as after: regressions are cases saw makes worse
}

const diff = (a?: number, b?: number): number | undefined => (a !== undefined && b !== undefined ? a - b : undefined);
const sum = (xs: (number | undefined)[]): number | undefined => (xs.some((x) => x === undefined) || !xs.length ? undefined : xs.reduce<number>((s, x) => s + (x as number), 0));

export function abCompare(onRaw: unknown, offRaw: unknown, maxTokenIncrease: number): AbResult {
  const on = summarise(onRaw);
  const off = summarise(offRaw);
  const names = [...new Set([...Object.keys(on), ...Object.keys(off)])].sort();
  const rows: AbRow[] = names.map((name) => {
    const a = on[name];
    const b = off[name];
    return { case: name, on: a, off: b, delta: { score: diff(a?.score, b?.score), tokens: diff(a?.tokens, b?.tokens), cost: diff(a?.cost, b?.cost) } };
  });
  const both = rows.filter((r) => r.on && r.off);
  const total = (pick: (r: AbRow) => CaseSummary): CaseSummary => {
    const tokens = sum(both.map((r) => pick(r).tokens));
    const cost = sum(both.map((r) => pick(r).cost));
    return { score: both.length ? both.reduce((s, r) => s + pick(r).score, 0) / both.length : 0, ...(tokens !== undefined ? { tokens } : {}), ...(cost !== undefined ? { cost } : {}) };
  };
  const tOn = total((r) => r.on!);
  const tOff = total((r) => r.off!);
  return {
    rows,
    totals: { case: "TOTAL", on: tOn, off: tOff, delta: { score: tOn.score - tOff.score, tokens: diff(tOn.tokens, tOff.tokens), cost: diff(tOn.cost, tOff.cost) } },
    comparison: compare(off, on, maxTokenIncrease),
  };
}

export function formatAb(r: AbResult): string {
  const f = (v: number | undefined, d: number, signed = false): string => (v === undefined ? "–" : `${signed && v > 0 ? "+" : ""}${v.toFixed(d)}`);
  const line = (row: AbRow): string =>
    [row.case.padEnd(24), f(row.on?.score, 2).padStart(6), f(row.off?.score, 2).padStart(6), f(row.delta.score, 2, true).padStart(7),
      f(row.on?.tokens, 0).padStart(9), f(row.off?.tokens, 0).padStart(9), f(row.delta.tokens, 0, true).padStart(9),
      f(row.on?.cost, 3).padStart(8), f(row.off?.cost, 3).padStart(8), f(row.delta.cost, 3, true).padStart(8)].join(" ");
  const head = ["case".padEnd(24), "on".padStart(6), "off".padStart(6), "Δpass".padStart(7), "tok on".padStart(9), "tok off".padStart(9), "Δtok".padStart(9), "$ on".padStart(8), "$ off".padStart(8), "Δ$".padStart(8)].join(" ");
  return ["saw eval --ab: saw on vs saw off (pass rate, tokens, cost)", head, ...r.rows.map(line), line(r.totals)].join("\n");
}

// Runs one arm and writes its result JSON to `out`; returns the exit code.
// Injected so tests never start `claude`.
export type EvalRunner = (out: string, env: Record<string, string>) => number;

// Both arms, then the table and .saw/evals-ab.json. Throws on a failed arm.
export function runAb(dir: string, runner: EvalRunner, maxTokenIncrease: number, readJson: (p: string) => unknown, writeJson: (p: string, v: unknown) => void): AbResult {
  const arms = { on: join(dir, "evals-ab-on.json"), off: join(dir, "evals-ab-off.json") };
  for (const [name, path, env] of [["on", arms.on, {}], ["off", arms.off, { SAW_DISABLE_HOOKS: "1" }]] as const) {
    rmSync(path, { force: true }); // never compare against a previous run's file
    const code = runner(path, env);
    if (code !== 0) throw new Error(`saw ${name} arm exited ${code}`);
    if (!existsSync(path)) throw new Error(`saw ${name} arm wrote no result`);
  }
  const result = abCompare(readJson(arms.on), readJson(arms.off), maxTokenIncrease);
  writeJson(join(dir, "evals-ab.json"), result);
  return result;
}
