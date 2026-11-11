// `saw adoption`: is the workflow being used? Counts, for this repo, from
// .saw/events.jsonl and .saw/metrics.jsonl: tasks opened against Stops and
// untasked prompts, the guard's denials, unverified exits and the tier spread.

import type { WorkflowEvent } from "./events";
import type { TaskMetric } from "./metrics";

export interface Adoption {
  since?: string;
  tasks_opened: number;
  stops: number;
  stops_without_task: number;
  prompts_without_task: number;
  routing_denials: number;
  verify_denials: number;
  untasked_edit_blocks: number;
  unverified_exits: { at: string; tier?: string; label?: string; reason: string }[];
  retiers: number;
  subagent_edits: number;
  tiers: Record<string, number>;
  // tasks opened / Stops; undefined with no Stops logged.
  ratio?: number;
}

// The Stop-gate reason saw gives for edits made with no task (task.ts UNTASKED).
const UNTASKED_REASON = "no saw task is open";

export function adoption(events: WorkflowEvent[], metrics: TaskMetric[], sinceDays?: number, now = new Date()): Adoption {
  const since = sinceDays !== undefined ? new Date(now.getTime() - sinceDays * 86_400_000).toISOString() : undefined;
  const es = since ? events.filter((e) => e.at >= since) : events;
  const ms = since ? metrics.filter((m) => m.at >= since) : metrics;
  const kind = (k: string): WorkflowEvent[] => es.filter((e) => e.kind === k);
  const denials = kind("guard.deny").map((e) => e.message);
  // saw task start logs "tier"; saw task retier logs "tier" with data.retier.
  const opened = kind("tier").filter((e) => !e.data?.retier);
  const tiers: Record<string, number> = {};
  for (const e of opened) {
    const t = String(e.data?.tier ?? "unknown");
    tiers[t] = (tiers[t] ?? 0) + 1;
  }
  // Older logs without "tier" events: fall back to finished tasks.
  if (!opened.length) for (const m of ms) tiers[m.tier] = (tiers[m.tier] ?? 0) + 1;
  const blocks = kind("gate.block");
  const stops = kind("gate.pass").length + blocks.length + kind("gate.untasked").length;
  const tasksOpened = opened.length || ms.length;
  return {
    ...(since ? { since } : {}),
    tasks_opened: tasksOpened,
    stops,
    stops_without_task: kind("gate.untasked").length,
    prompts_without_task: kind("nudge").length,
    routing_denials: denials.filter((m) => m.startsWith("saw guard: routing:")).length,
    verify_denials: denials.filter((m) => m.startsWith("saw guard: verify:")).length,
    untasked_edit_blocks: blocks.filter((e) => e.message.includes(UNTASKED_REASON)).length,
    unverified_exits: kind("task.unverified").map((e) => ({
      at: e.at,
      ...(typeof e.data?.tier === "string" ? { tier: e.data.tier } : {}),
      ...(typeof e.data?.label === "string" ? { label: e.data.label } : {}),
      reason: String(e.data?.reason ?? e.message),
    })),
    retiers: kind("tier").filter((e) => e.data?.retier).length,
    subagent_edits: kind("subagent.edits").length,
    tiers,
    ...(stops ? { ratio: tasksOpened / stops } : {}),
  };
}

export function formatAdoption(a: Adoption): string {
  const tiers = Object.entries(a.tiers).map(([t, n]) => `${t} ${n}`).join(", ") || "none";
  return [
    `saw adoption${a.since ? ` since ${a.since.slice(0, 10)}` : ""}`,
    `  tasks opened        ${a.tasks_opened}${a.ratio !== undefined ? `  (${(a.ratio * 100).toFixed(0)}% of ${a.stops} Stops)` : ""}`,
    `  Stops with no task  ${a.stops_without_task}`,
    `  prompts, no task    ${a.prompts_without_task}`,
    `  routing denials     ${a.routing_denials}`,
    `  verify denials      ${a.verify_denials}`,
    `  untasked edits      ${a.untasked_edit_blocks} blocked at Stop`,
    `  subagent edit runs  ${a.subagent_edits}`,
    `  retiers             ${a.retiers}`,
    `  tier spread         ${tiers}`,
    `  unverified exits    ${a.unverified_exits.length}`,
    ...a.unverified_exits.map((u) => `    ${u.at.slice(0, 10)} ${[u.tier, u.label].filter(Boolean).join(" ")}: ${u.reason}`),
  ].join("\n");
}

// The dashboard card: the headline ratio, then the counts behind it.
export function adoptionHtml(a: Adoption, esc: (s: string) => string): string {
  const row = (label: string, value: number | string): string => `<div class="row"><span class="lbl">${esc(label)}</span><span class="val">${esc(String(value))}</span></div>`;
  const head = a.ratio !== undefined ? `${(a.ratio * 100).toFixed(0)}%` : "–";
  return `<section class="panel"><h2>Adoption</h2><p class="hint">Tasks opened per Stop (saw adoption). Low means work happens outside saw tasks.</p>`
    + `<p class="kpi-big">${esc(head)}</p>`
    + row("tasks opened", a.tasks_opened) + row("Stops", a.stops) + row("Stops with no task", a.stops_without_task)
    + row("prompts with no task", a.prompts_without_task) + row("routing / verify denials", `${a.routing_denials} / ${a.verify_denials}`)
    + row("unverified exits", a.unverified_exits.length) + row("retiers", a.retiers)
    + `</section>`;
}

// `saw adoption --features`: how often each feature and mod fired in the
// window, rarest first. A count comes from the event kinds (or task metrics)
// that only that feature produces; a feature or mod that logs nothing today
// is "not measurable", never zero. Report only: it removes nothing.
const FEATURE_SIGNALS: Record<string, { kinds?: string[]; metric?: (m: TaskMetric) => boolean }> = {
  verify_hook: { kinds: ["gate.block", "gate.pass", "gate.untasked"] },
  budgets: { kinds: ["budget"] },
  format_hook: { kinds: ["format"] },
  recommend: { kinds: ["recommend", "recommend.add"] },
  implementer: { kinds: ["subagent.edits"] },
  code_review: { kinds: ["review.start", "review.result", "review.refused"], metric: (m) => "code_review" in (m.findings ?? {}) },
  security_review: { metric: (m) => "security_review" in (m.findings ?? {}) },
  metrics: { metric: () => true },
};

export interface UsageRow {
  name: string;
  type: "feature" | "mod";
  count: number;
}

export interface FeatureUsage {
  since?: string;
  rows: UsageRow[]; // ascending by count
  candidates: string[]; // count 0: candidates to cut
  not_measurable: { name: string; type: "feature" | "mod" }[];
}

export function featureUsage(features: string[], mods: string[], events: WorkflowEvent[], metrics: TaskMetric[], sinceDays?: number, now = new Date()): FeatureUsage {
  const since = sinceDays !== undefined ? new Date(now.getTime() - sinceDays * 86_400_000).toISOString() : undefined;
  const es = since ? events.filter((e) => e.at >= since) : events;
  const ms = since ? metrics.filter((m) => m.at >= since) : metrics;
  const rows: UsageRow[] = [];
  const notMeasurable: FeatureUsage["not_measurable"] = [];
  for (const f of features) {
    const s = FEATURE_SIGNALS[f];
    if (!s) {
      notMeasurable.push({ name: f, type: "feature" });
      continue;
    }
    const count = es.filter((e) => s.kinds?.includes(e.kind)).length + (s.metric ? ms.filter((m) => s.metric!(m)).length : 0);
    rows.push({ name: f, type: "feature", count });
  }
  // No mod logs to .saw/events.jsonl today; one that does names itself in data.mod.
  for (const m of mods) {
    const count = es.filter((e) => e.data?.mod === m).length;
    if (count) rows.push({ name: m, type: "mod", count });
    else notMeasurable.push({ name: m, type: "mod" });
  }
  rows.sort((a, b) => a.count - b.count || a.name.localeCompare(b.name));
  return { ...(since ? { since } : {}), rows, candidates: rows.filter((r) => r.count === 0).map((r) => r.name), not_measurable: notMeasurable };
}

export function formatFeatureUsage(u: FeatureUsage): string {
  return [
    `saw adoption --features${u.since ? ` since ${u.since.slice(0, 10)}` : ""} (report only; nothing is removed)`,
    ...u.rows.map((r) => `  ${String(r.count).padStart(5)}  ${r.type === "mod" ? "mod    " : "feature"}  ${r.name}${r.count === 0 ? "  <- candidate to cut" : ""}`),
    `  not measurable (logs no event): ${u.not_measurable.map((n) => (n.type === "mod" ? `mod:${n.name}` : n.name)).join(", ") || "none"}`,
  ].join("\n");
}
