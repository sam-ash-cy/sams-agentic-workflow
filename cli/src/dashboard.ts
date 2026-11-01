// `saw dashboard`: a self-contained static HTML page (no scripts, no network)
// built from .saw/metrics.jsonl, with the panels listed in [dashboard].panels.
// Optionally also a Markdown note for the Obsidian vault.

import type { TaskMetric } from "./metrics";
import type { RunRecord } from "./autopilot";
import type { Proposal } from "./retro";
import { TIERS } from "./task";

interface Bar {
  label: string;
  value: number;
  text: string;
}

interface Panel {
  title: string;
  hint: string;
  bars: Bar[];
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (n: number): string => `${Math.round(n * 100)}%`;
const fmt = (n: number): string => (n >= 10000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function byTier(metrics: TaskMetric[], f: (ms: TaskMetric[]) => { value: number; text: string } | undefined): Bar[] {
  return TIERS.flatMap((tier) => {
    const ms = metrics.filter((m) => m.tier === tier);
    const r = ms.length ? f(ms) : undefined;
    return r ? [{ label: `${tier} (${ms.length})`, ...r }] : [];
  });
}

export const PANELS: Record<string, (ms: TaskMetric[], proposals: Proposal[], runs: RunRecord[]) => Panel> = {
  first_pass_rate: (ms) => ({
    title: "First-pass rate",
    hint: "Tasks that reached Verified with no failed check along the way.",
    bars: byTier(ms, (t) => {
      const r = t.filter((m) => m.first_pass).length / t.length;
      return { value: r, text: pct(r) };
    }),
  }),
  rework: (ms) => ({
    title: "Rework per task",
    hint: "Average number of failed check runs before the task ended.",
    bars: byTier(ms, (t) => {
      const avg = t.reduce((a, m) => a + m.rework, 0) / t.length;
      return { value: avg, text: avg.toFixed(1) };
    }),
  }),
  cost_per_task: (ms) => ({
    title: "Tokens per task (median)",
    hint: "From --tokens or the session transcript; tasks without a count are left out.",
    bars: byTier(ms, (t) => {
      const counted = t.map((m) => m.tokens).filter((x): x is number => typeof x === "number");
      if (!counted.length) return undefined;
      const med = median(counted);
      return { value: med, text: fmt(med) };
    }),
  }),
  findings_by_category: (ms) => {
    const totals: Record<string, number> = {};
    for (const m of ms) for (const [k, n] of Object.entries(m.findings ?? {})) totals[k] = (totals[k] ?? 0) + n;
    return {
      title: "Failures by check",
      hint: "Which checks fail most: where a lint rule, test or skill fix would pay off.",
      bars: Object.entries(totals)
        .sort((a, b) => b[1] - a[1])
        .map(([label, n]) => ({ label, value: n, text: String(n) })),
    };
  },
  outcomes: (ms) => {
    const labels = ["Verified", "Partially verified", "Not verified", "Blocked"];
    return {
      title: "Outcomes",
      hint: "How tasks ended, by report label.",
      bars: labels.map((l) => {
        const n = ms.filter((m) => m.label === l).length;
        return { label: l, value: n, text: String(n) };
      }).filter((b) => b.value > 0),
    };
  },
  promotion_effect: (ms, proposals) => ({
    title: "Promotion effect",
    hint: "Share of tasks where the check failed, before and after its promoted fix (saw retro proposals).",
    bars: proposals.flatMap((p) => {
      if (p.status !== "promoted" || !p.promoted) return [];
      const rate = (t: TaskMetric[]): number => t.filter((m) => (m.findings?.[p.check] ?? 0) > 0).length / t.length;
      const before = ms.filter((m) => m.at.slice(0, 10) < p.promoted!);
      const after = ms.filter((m) => m.at.slice(0, 10) >= p.promoted!);
      if (!before.length || !after.length) return [];
      return [{ label: `${p.check} (${after.length} after)`, value: rate(after), text: `${pct(rate(before))} → ${pct(rate(after))}` }];
    }),
  }),
  autopilot: (_ms, _p, runs) => ({
    title: "Autopilot",
    hint: "saw autopilot items by outcome, and usage-limit waits, with their cost.",
    bars: (["pr", "parked", "waiting"] as const).flatMap((o) => {
      const rs = runs.filter((r) => r.outcome === o);
      const usd = rs.reduce((a, r) => a + r.cost_usd, 0);
      return rs.length ? [{ label: { pr: "finished", parked: "parked", waiting: "limit waits" }[o], value: rs.length, text: `${rs.length} · $${usd.toFixed(2)}` }] : [];
    }),
  }),
};

export function buildPanels(metrics: TaskMetric[], names: string[], proposals: Proposal[] = [], runs: RunRecord[] = []): Panel[] {
  return names.filter((n) => n in PANELS).map((n) => PANELS[n]!(metrics, proposals, runs));
}

function panelHtml(p: Panel): string {
  const max = Math.max(...p.bars.map((b) => b.value), 0) || 1;
  const rows = p.bars.length
    ? p.bars
        .map(
          (b) => `<div class="row"><span class="lbl">${esc(b.label)}</span><span class="track"><span class="bar" style="width:${Math.max(2, (b.value / max) * 100).toFixed(1)}%"></span></span><span class="val">${esc(b.text)}</span></div>`,
        )
        .join("")
    : `<p class="empty">No data yet.</p>`;
  return `<section class="panel"><h2>${esc(p.title)}</h2><p class="hint">${esc(p.hint)}</p>${rows}</section>`;
}

export function renderHtml(metrics: TaskMetric[], names: string[], proposals: Proposal[] = [], runs: RunRecord[] = [], generated = new Date()): string {
  const verified = metrics.filter((m) => m.label === "Verified").length;
  const kpis = [
    ["Tasks", String(metrics.length)],
    ["Verified", metrics.length ? pct(verified / metrics.length) : "–"],
    ["First pass", metrics.length ? pct(metrics.filter((m) => m.first_pass).length / metrics.length) : "–"],
  ];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Workflow metrics</title>
<style>
:root{--bg:#f7f7f5;--card:#fff;--ink:#1d1d1b;--muted:#6b6b66;--line:#e4e4df;--bar:#2f6f62}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--card:#1f1f1d;--ink:#ecece8;--muted:#9a9a94;--line:#33332f;--bar:#5fb3a1}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 20px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px}
.kpi,.panel{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.kpi b{display:block;font-size:26px;font-variant-numeric:tabular-nums}.kpi span{color:var(--muted);font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:12px}
h2{font-size:15px;margin:0}.hint{color:var(--muted);font-size:13px;margin:2px 0 10px}.empty{color:var(--muted);margin:0}
.row{display:grid;grid-template-columns:minmax(0,9rem) 1fr 3.5rem;gap:8px;align-items:center;margin:6px 0}
.lbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.track{background:var(--line);border-radius:4px;height:10px}
.bar{display:block;height:100%;background:var(--bar);border-radius:4px}.val{text-align:right;font-variant-numeric:tabular-nums}
</style></head><body><main>
<h1>Workflow metrics</h1><p class="sub">${metrics.length} tasks · generated ${esc(generated.toISOString().slice(0, 16).replace("T", " "))} UTC</p>
<div class="kpis">${kpis.map(([k, v]) => `<div class="kpi"><b>${esc(v!)}</b><span>${esc(k!)}</span></div>`).join("")}</div>
<div class="grid">${buildPanels(metrics, names, proposals, runs).map(panelHtml).join("")}</div>
</main></body></html>
`;
}

export function renderMarkdown(metrics: TaskMetric[], names: string[], proposals: Proposal[] = [], runs: RunRecord[] = []): string {
  const out = ["---", "tags: [metrics]", "---", "# Workflow metrics", "", `${metrics.length} tasks.`, ""];
  for (const p of buildPanels(metrics, names, proposals, runs)) {
    out.push(`## ${p.title}`, "", p.hint, "");
    if (!p.bars.length) out.push("No data yet.", "");
    else out.push("| | |", "|---|---|", ...p.bars.map((b) => `| ${b.label} | ${b.text} |`), "");
  }
  return out.join("\n");
}
