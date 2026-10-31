// `saw eval`: runs the eval suite with `claude plugin eval` and compares it
// with a saved baseline. A change passes only if no case scores lower, and no
// case at the same score costs more than evals.max_token_increase extra tokens.
// The result JSON isn't a documented contract, so `summarise` reads it
// tolerantly: any array of objects with a case name and a score.

export interface CaseSummary {
  score: number;
  tokens?: number;
}

export type Summary = Record<string, CaseSummary>;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function caseOf(o: Record<string, unknown>): [string, CaseSummary] | undefined {
  const name = [o.name, o.case, o.case_name, o.id].find((v) => typeof v === "string") as string | undefined;
  const score = num(o.score) ?? num(o.mean_score) ?? num(o.pass_rate);
  if (!name || score === undefined) return undefined;
  const usage = (o.usage ?? {}) as Record<string, unknown>;
  const tokens = num(o.tokens) ?? num(o.mean_tokens) ?? num(o.total_tokens) ?? num(usage.total_tokens);
  return [name, tokens === undefined ? { score } : { score, tokens }];
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
