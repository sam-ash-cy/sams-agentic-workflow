// `saw autopilot`: works through the owner-approved items in the
// queue, one fresh headless session, branch and PR per item. On a usage limit
// it saves state, waits for the reset and resumes the same session. It never
// approves, merges, pushes to the base branch or deploys.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { baseBranch } from "./config";
import type { Table } from "./defaults";

export interface AutopilotSettings {
  enabled: boolean;
  queue: string;
  per_item_usd: number;
  max_total_usd: number;
  max_failures: number;
  max_wait: string;
  resume_on_limit: boolean;
  auto_approve_tiers: string[];
}

export interface QueueItem {
  status: string;
  slug: string;
  text: string;
  // Optional indented sub-lines; absent when the item has none.
  tier?: string;
  needs?: string[];
  accept?: string[];
  adr?: string;
}

export type Outcome = "pr" | "parked" | "waiting";

export interface AutopilotState {
  spent_usd: number;
  failures: number;
  done: Record<string, Exclude<Outcome, "waiting">>;
  // base: the branch it was cut from (the base branch, or a dependency's branch when stacked).
  current?: { slug: string; branch: string; session_id: string; waits: number; until?: string; base?: string };
}

export interface RunRecord {
  kind: "autopilot";
  at: string;
  item: string;
  outcome: Outcome | "stopped";
  cost_usd: number;
  note?: string;
}

// The headless run's result. Injected in tests; the real one spawns claude.
export interface Session {
  code: number;
  cost_usd: number;
  is_error: boolean;
  text: string;
}

export interface Deps {
  claude: (argv: string[], prompt: string) => Session;
  git: (args: string[]) => { code: number; out: string };
  gh: (args: string[]) => { code: number; out: string };
  sleep: (ms: number) => void;
  now: () => Date;
  uuid: () => string;
  log: (line: string) => void;
}

export const settings = (config: Table): AutopilotSettings => config.autopilot as unknown as AutopilotSettings;

// `- [approved] slug: what to build`. Anything else in the file is prose.
const ITEM = /^\s*[-*]\s+\[(\w+)\]\s+([\w.-]+):?\s*(.*)$/;

// `  - tier: standard`, `  - needs: a, b`, `  - accept: ...` (repeatable), `  - adr: path`.
const SUB = /^\s+[-*]\s+(tier|needs|accept|adr):\s*(.*)$/i;

export function parseQueue(text: string): QueueItem[] {
  const items: QueueItem[] = [];
  for (const l of text.split(/\r?\n/)) {
    const m = ITEM.exec(l);
    if (m) {
      items.push({ status: m[1]!.toLowerCase(), slug: m[2]!, text: m[3]!.trim() });
      continue;
    }
    const sub = SUB.exec(l);
    const last = items.at(-1);
    if (!sub || !last) continue;
    const key = sub[1]!.toLowerCase();
    const v = sub[2]!.trim();
    if (key === "tier") last.tier = v.toLowerCase();
    else if (key === "adr") last.adr = v;
    else if (key === "needs") last.needs = [...(last.needs ?? []), ...v.split(",").map((x) => x.trim()).filter(Boolean)];
    else if (v) last.accept = [...(last.accept ?? []), v];
  }
  return items;
}

const NEVER_AUTO = ["complex", "critical"];

// autopilot.auto_approve_tiers without complex/critical (those always need the owner).
export function autoApproveTiers(config: Table): { tiers: string[]; warnings: string[] } {
  const raw = settings(config).auto_approve_tiers ?? [];
  const listed = Array.isArray(raw) ? raw.map((t) => String(t).toLowerCase()) : [];
  const ignored = listed.filter((t) => NEVER_AUTO.includes(t));
  return {
    tiers: listed.filter((t) => !NEVER_AUTO.includes(t)),
    warnings: ignored.length ? [`autopilot.auto_approve_tiers lists ${ignored.join(", ")}; ignored (complex and critical items always need the owner's approval)`] : [],
  };
}

// The owner's `approved`, or a `proposed` item whose tier auto-approves. No tier: never.
// `committed`: the queue as committed on the base branch. When given, only an item
// proposed there, with the tier it has there, auto-approves, so a session can't
// add or relabel an item in the working tree and have it run unreviewed.
export const isApproved = (i: QueueItem, tiers: string[] = [], committed?: Map<string, QueueItem>): boolean => {
  if (i.status === "approved") return true;
  if (i.status !== "proposed") return false;
  const c = committed ? committed.get(i.slug) : i;
  return !!c && c.status === "proposed" && !!c.tier && tiers.includes(c.tier);
};

// The queue file as committed on the base branch (empty when it can't be read).
export function committedQueue(config: Table, deps: Pick<Deps, "git">): Map<string, QueueItem> {
  const r = deps.git(["show", `${baseBranch(config)}:${settings(config).queue}`]);
  return new Map((r.code === 0 ? parseQueue(r.out) : []).map((i) => [i.slug, i]));
}

export interface PlannedItem {
  item: QueueItem;
  // The branch it is (or would be) cut from, and the PR's --base.
  base: string;
  note?: string;
}

export interface QueuePlan {
  order: PlannedItem[];
  skipped: { slug: string; reason: string }[];
  cycle?: string[];
}

// Is branch `b` already merged into `base`? Read-only (`merge-base --is-ancestor`):
// exit 1 is "not an ancestor"; any other failure (a deleted branch after its PR
// merged) counts as merged, so the item is cut from the base.
const merged = (deps: Pick<Deps, "git">, b: string, base: string): boolean => deps.git(["merge-base", "--is-ancestor", b, base]).code !== 1;

// The run order: approved items not yet done, each after its `needs`. Items
// whose dependency is parked, missing or unapproved are skipped (not failures).
// A dependency whose branch isn't merged into the base yet stacks the item on
// that branch (the most recently finished one when several).
export function planQueue(items: QueueItem[], state: AutopilotState, config: Table, deps: Pick<Deps, "git">): QueuePlan {
  const { tiers } = autoApproveTiers(config);
  const base = baseBranch(config);
  const committed = tiers.length ? committedQueue(config, deps) : new Map<string, QueueItem>();
  const approved = (i: QueueItem): boolean => isApproved(i, tiers, committed);
  const bySlug = new Map(items.map((i) => [i.slug, i]));
  const pending = items.filter((i) => approved(i) && !state.done[i.slug]);
  const pendingSet = new Set(pending.map((i) => i.slug));

  // A cycle among pending items stops the whole run.
  const color = new Map<string, number>();
  const stack: string[] = [];
  let cycle: string[] | undefined;
  const visit = (s: string): void => {
    color.set(s, 1);
    stack.push(s);
    for (const n of bySlug.get(s)?.needs ?? []) {
      if (cycle) return;
      if (!pendingSet.has(n)) continue;
      if (color.get(n) === 1) cycle = [...stack.slice(stack.indexOf(n)), n];
      else if (!color.get(n)) visit(n);
    }
    stack.pop();
    color.set(s, 2);
  };
  for (const i of pending) if (!cycle && !color.get(i.slug)) visit(i.slug);
  if (cycle) return { order: [], skipped: [], cycle };

  const order: PlannedItem[] = [];
  const skipped: QueuePlan["skipped"] = [];
  const skippedSet = new Set<string>();
  const placed = new Set<string>();
  // Finished items rank first (in the order they finished), then planned ones.
  const rank = new Map<string, number>(Object.keys(state.done).map((s, n) => [s, n]));
  const why = (i: QueueItem): string | undefined => {
    for (const n of i.needs ?? []) {
      if (state.done[n] === "pr") continue;
      const d = bySlug.get(n);
      if (state.done[n] === "parked") return `needs ${n}, which was parked`;
      if (!d) return `needs ${n}, which is not in the queue`;
      if (skippedSet.has(n)) return `needs ${n}, which is skipped`;
      if (!approved(d)) return `needs ${n}, which is not approved (${d.status})`;
    }
    return undefined;
  };
  for (let progress = true; progress; ) {
    progress = false;
    for (const i of pending) {
      if (placed.has(i.slug) || skippedSet.has(i.slug)) continue;
      const reason = why(i);
      if (reason) {
        skipped.push({ slug: i.slug, reason });
        skippedSet.add(i.slug);
        progress = true;
        continue;
      }
      if (!(i.needs ?? []).every((n) => state.done[n] === "pr" || placed.has(n))) continue;
      const stacks = (i.needs ?? []).filter((n) => placed.has(n) || !merged(deps, `autopilot/${n}`, base));
      const top = [...stacks].sort((a, b) => (rank.get(a) ?? -1) - (rank.get(b) ?? -1)).at(-1);
      const p: PlannedItem = { item: i, base: top ? `autopilot/${top}` : base };
      if (top && stacks.length > 1) p.note = `stacked on ${p.base}, the most recent of ${stacks.map((s) => `autopilot/${s}`).join(", ")} (not merged into ${base} yet)`;
      else if (top) p.note = `stacked on ${p.base} (not merged into ${base} yet)`;
      order.push(p);
      placed.add(i.slug);
      rank.set(i.slug, rank.size);
      progress = true;
    }
  }
  return { order, skipped };
}

// What may run now, in queue order: approved, not done, every dependency done with a PR.
export const eligible = (items: QueueItem[], state: AutopilotState, tiers: string[] = []): QueueItem[] =>
  items.filter((i) => isApproved(i, tiers) && !state.done[i.slug] && (i.needs ?? []).every((n) => state.done[n] === "pr"));

// "6h", "90m", "45s" or a bare number of seconds.
export function durationMs(s: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*([smhd]?)$/.exec(s.trim());
  if (!m) throw new Error(`autopilot.max_wait "${s}" is not a duration like 6h or 90m`);
  return Number(m[1]) * { "": 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2]!]! * 1000;
}

// A usage or rate limit, never the --max-budget-usd stop (that one ends the item).
export const LIMIT = /usage limit|rate limit|(5-hour|weekly|session) limit|limit reached|b429b|overloaded/i;
const BUDGET = /budget/i;

// The reset time from a usage-limit message: `...limit reached|<epoch>` or
// `resets 3pm` / `resets at 15:30`. Undefined when the message has none.
export function resetAt(text: string, now: Date): Date | undefined {
  const epoch = /limit[^|\n]*\|(\d{10})\b/i.exec(text);
  if (epoch) return new Date(Number(epoch[1]) * 1000);
  const t = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (!t) return undefined;
  let h = Number(t[1]);
  const ampm = t[3]?.toLowerCase();
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (h > 23) return undefined;
  const d = new Date(now);
  d.setHours(h, Number(t[2] ?? 0), 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d;
}

// Wait until the reset (plus a minute), or back off 15m, 30m, 60m... capped at max_wait.
export function waitMs(text: string, now: Date, waits: number, maxWait: string): number {
  const cap = durationMs(maxWait);
  const reset = resetAt(text, now);
  const ms = reset ? reset.getTime() - now.getTime() + 60_000 : 15 * 60_000 * 2 ** waits;
  return Math.min(Math.max(ms, 60_000), cap);
}

const statePath = (cwd: string): string => join(cwd, ".saw", "autopilot.json");

export function readState(cwd: string): AutopilotState {
  const fresh: AutopilotState = { spent_usd: 0, failures: 0, done: {} };
  if (!existsSync(statePath(cwd))) return fresh;
  try {
    return { ...fresh, ...(JSON.parse(readFileSync(statePath(cwd), "utf8")) as AutopilotState) };
  } catch {
    return fresh;
  }
}

function saveState(cwd: string, state: AutopilotState): void {
  mkdirSync(join(cwd, ".saw"), { recursive: true });
  writeFileSync(statePath(cwd), JSON.stringify(state, null, 2) + "\n");
}

function record(cwd: string, rec: Omit<RunRecord, "kind">): void {
  mkdirSync(join(cwd, ".saw"), { recursive: true });
  appendFileSync(join(cwd, ".saw", "metrics.jsonl"), JSON.stringify({ kind: "autopilot", ...rec }) + "\n");
}

// The runner, not the session, pushes the item's branch and opens its PR: only
// when autonomy.actions.open_pr is "allow" and pushing is allowed (the
// stricter of safety.push and autonomy.actions.push).
export function opensPr(config: Table): boolean {
  const actions = ((config.autonomy ?? {}) as { actions?: Record<string, string> }).actions ?? {};
  const push = ((config.safety ?? {}) as { push?: string }).push;
  return actions.open_pr === "allow" && push === "allow" && actions.push === "allow";
}

// What the session is told. The router runs as usual and the guard hook
// enforces [safety] and [autonomy]; the session only commits on its branch.
export function itemBrief(config: Table, item: QueueItem, branch: string): string {
  return [
    `Autopilot item ${item.slug}: ${item.text || "(see the queue for details)"}`,
    `You are on branch ${branch}. Use the router skill: pick the tier and playbook, then follow them through the gate.`,
    `When the gate passes, commit on ${branch} and stop. ${opensPr(config) ? "The runner pushes the branch and opens the PR." : "The owner opens the PR."} Don't push or open a PR yourself.`,
    "Never merge, never deploy, and never edit the queue's approvals. You may add new ideas to the queue only as `- [proposed] slug: text`.",
    "If you can't finish, end with a final line `Blocked: <reason>` or `Not verified: <reason>`.",
  ].join("\n");
}

// Mechanical backstop: merging, force pushes and pushes to the base branch never run.
export const disallowed = (base: string): string[] => ["Bash(gh pr merge:*)", "Bash(git merge:*)", "Bash(git push --force:*)", "Bash(git push -f:*)", ...[base, "main", "master"].flatMap((b) => [`Bash(git push origin ${b}:*)`, `Bash(git push origin HEAD:${b}:*)`, `Bash(git push -u origin ${b}:*)`])];

// The prompt goes on stdin: a multi-line argument breaks the claude.cmd shim npm installs on Windows.
export function claudeArgv(sessionId: string, perItem: number, resume: boolean, base = "main"): string[] {
  return ["claude", "-p", resume ? "--resume" : "--session-id", sessionId, "--max-budget-usd", String(perItem), "--output-format", "json", "--disallowedTools", [...new Set(disallowed(base))].join(",")];
}

// The reasons the runner must not start (or go on). Empty: OK to run an item.
export function stopReasons(cwd: string, config: Table, state: AutopilotState, weakened: string[]): string[] {
  const s = settings(config);
  const out: string[] = [];
  if (!s.enabled) out.push("autopilot.enabled is false");
  if (existsSync(join(cwd, ".saw", "STOP"))) out.push(".saw/STOP exists (delete it to resume)");
  if (state.spent_usd >= s.max_total_usd) out.push(`spent $${state.spent_usd.toFixed(2)} of autopilot.max_total_usd $${s.max_total_usd}`);
  if (state.failures >= s.max_failures) out.push(`${state.failures} items failed in a row (autopilot.max_failures = ${s.max_failures})`);
  // Allowing pushes is how the runner opens PRs (opensPr); any other loosened [safety] key stops it.
  for (const w of weakened) if (!w.startsWith("safety.push ")) out.push(`weakened guardrail: ${w}`);
  return out;
}

const FAILED = /^\s*(Blocked|Not verified)\b/im;

// Runs items until a stop. Returns the exit code: 0 for an empty queue or a
// clean stop on --once, 1 for a guardrail or budget stop.
export function autopilot(cwd: string, config: Table, weakened: string[], deps: Deps, opts: { once?: boolean } = {}): number {
  const s = settings(config);
  const state = readState(cwd);
  const queuePath = join(cwd, s.queue);
  const { tiers, warnings } = autoApproveTiers(config);
  for (const w of warnings) deps.log(`warning: ${w}`);
  const loggedSkips = new Set<string>();
  for (;;) {
    const reasons = stopReasons(cwd, config, state, weakened);
    if (reasons.length) {
      for (const r of reasons) deps.log(`stop: ${r}`);
      return 1;
    }
    const items = existsSync(queuePath) ? parseQueue(readFileSync(queuePath, "utf8")) : [];
    let next: PlannedItem | undefined;
    if (!state.current) {
      const plan = planQueue(items, state, config, deps);
      if (plan.cycle) {
        deps.log(`stop: dependency cycle in ${s.queue}: ${plan.cycle.join(" -> ")}; fix the needs: lines`);
        return 1;
      }
      for (const k of plan.skipped) {
        if (loggedSkips.has(k.slug)) continue;
        loggedSkips.add(k.slug);
        deps.log(`skip ${k.slug}: ${k.reason}`);
      }
      // Only an item whose dependencies are all done runs now.
      next = plan.order.find((p) => (p.item.needs ?? []).every((n) => state.done[n] === "pr"));
    }
    const item = state.current ? items.find((i) => i.slug === state.current!.slug) : next?.item;
    if (!item || (state.current && item.status !== "approved" && !isApproved(item, tiers, committedQueue(config, deps)))) {
      if (state.current) {
        deps.log(`stop: ${state.current.slug} is no longer approved in ${s.queue}; resume it by hand or delete .saw/autopilot.json`);
        return 1;
      }
      deps.log(loggedSkips.size ? `nothing to run: ${loggedSkips.size} item(s) skipped for their dependencies in ${s.queue}` : `queue empty: no approved items left in ${s.queue}`);
      return 0;
    }

    let resume = false;
    if (state.current) {
      resume = s.resume_on_limit;
      const until = state.current.until ? Date.parse(state.current.until) : 0;
      const left = until - deps.now().getTime();
      if (left > 0) {
        deps.log(`waiting ${Math.ceil(left / 60_000)}m for the usage limit to reset (${state.current.until})`);
        deps.sleep(left);
      }
      if (!resume) state.current = { ...state.current, session_id: deps.uuid() };
      // After a restart the checkout may be anywhere (usually the base branch).
      const back = deps.git(["switch", state.current.branch]);
      if (back.code !== 0) {
        deps.log(`stop: could not switch back to ${state.current.branch}: ${back.out.trim()}`);
        return 1;
      }
    } else {
      const dirty = deps.git(["status", "--porcelain"]);
      if (dirty.code !== 0 || dirty.out.trim()) {
        deps.log("stop: the working tree is not clean; commit or stash first");
        return 1;
      }
      const branch = `autopilot/${item.slug}`;
      const from = next!.base;
      if (next!.note) deps.log(`${item.slug}: ${next!.note}`);
      const sw = deps.git(["switch", "-c", branch, from]);
      // An existing branch (an earlier, parked attempt) is never reused silently.
      if (sw.code !== 0) {
        deps.log(`stop: could not create ${branch} from ${from} (delete or rename an old one first): ${sw.out.trim()}`);
        return 1;
      }
      state.current = { slug: item.slug, branch, session_id: deps.uuid(), waits: 0, base: from };
      saveState(cwd, state);
    }

    const cur = state.current!;
    deps.log(`${resume ? "resuming" : "starting"} ${item.slug} on ${cur.branch} (session ${cur.session_id}, cap $${s.per_item_usd})`);
    const prompt = resume ? "Continue where you stopped; the usage limit has reset." : itemBrief(config, item, cur.branch);
    const r = deps.claude(claudeArgv(cur.session_id, s.per_item_usd, resume, baseBranch(config)), prompt);
    state.spent_usd += r.cost_usd;
    const at = deps.now().toISOString();

    if (r.is_error && LIMIT.test(r.text) && !BUDGET.test(r.text)) {
      const ms = waitMs(r.text, deps.now(), cur.waits, s.max_wait);
      state.current = { ...cur, waits: cur.waits + 1, until: new Date(deps.now().getTime() + ms).toISOString() };
      saveState(cwd, state);
      record(cwd, { at, item: item.slug, outcome: "waiting", cost_usd: r.cost_usd, note: `until ${state.current.until}` });
      deps.log(`usage limit on ${item.slug}; state saved, resuming after ${state.current.until}`);
      continue;
    }

    const failed = r.code !== 0 || r.is_error || FAILED.test(r.text);
    state.done[item.slug] = failed ? "parked" : "pr";
    state.failures = failed ? state.failures + 1 : 0;
    delete state.current;
    saveState(cwd, state);
    let note = failed ? (FAILED.exec(r.text)?.[0]?.trim() ?? `claude exit ${r.code}`) : undefined;
    let done = `branch ${cur.branch} is ready; open its PR when you've looked`;
    if (!failed && opensPr(config)) {
      // Only the item's own branch, never the base; the owner reviews and merges.
      const push = deps.git(["push", "-u", "origin", cur.branch]);
      const pr = push.code === 0
        ? deps.gh(["pr", "create", "--base", cur.base ?? baseBranch(config), "--head", cur.branch, "--title", `autopilot: ${item.slug}`, "--body", `${item.text}\n\nOpened by saw autopilot. Review before merging; it never merges.`])
        : push;
      done = pr.code === 0 ? `PR opened: ${pr.out.trim().split("\n").pop()}` : `committed on ${cur.branch}, but the PR failed: ${pr.out.trim()}`;
      if (pr.code !== 0) note = "PR not opened";
    }
    record(cwd, { at, item: item.slug, outcome: state.done[item.slug]!, cost_usd: r.cost_usd, ...(note ? { note } : {}) });
    deps.log(`${item.slug}: ${failed ? `parked (${note})` : done} · $${r.cost_usd.toFixed(2)} · total $${state.spent_usd.toFixed(2)}`);
    deps.git(["switch", baseBranch(config)]);
    if (opts.once) return 0;
  }
}

// The real claude: JSON output gives cost and error state; a crash or
// non-JSON output (an old CLI) counts as an error with the raw text.
export function spawnClaude(cwd: string): (argv: string[], prompt: string) => Session {
  return (argv, prompt) => {
    let p: ReturnType<typeof Bun.spawnSync>;
    try {
      p = Bun.spawnSync(argv, { cwd, stdin: Buffer.from(prompt), stdout: "pipe", stderr: "pipe" });
    } catch (e) {
      return { code: 1, cost_usd: 0, is_error: true, text: `could not start claude: ${(e as Error).message}` };
    }
    const out = p.stdout.toString();
    try {
      const j = JSON.parse(out) as { is_error?: boolean; result?: string; total_cost_usd?: number };
      return { code: p.exitCode ?? 1, cost_usd: j.total_cost_usd ?? 0, is_error: j.is_error === true, text: j.result ?? "" };
    } catch {
      return { code: p.exitCode ?? 1, cost_usd: 0, is_error: true, text: out + p.stderr.toString() };
    }
  };
}

// `--install-schedule`: the command to register, printed and never run.
export function scheduleCommand(cwd: string, platform = process.platform): string {
  if (platform === "win32") return `schtasks /Create /TN "saw autopilot" /SC HOURLY /TR "cmd /c cd /d \\"${cwd}\\" && saw autopilot"`;
  const line = `0 * * * * cd ${JSON.stringify(cwd)} && saw autopilot >> .saw/autopilot.log 2>&1`;
  return platform === "darwin" ? `(crontab -l 2>/dev/null; echo '${line}') | crontab -   # or a launchd plist` : `(crontab -l 2>/dev/null; echo '${line}') | crontab -`;
}

export function readRuns(cwd: string): RunRecord[] {
  const path = join(cwd, ".saw", "metrics.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").flatMap((l) => {
    try {
      const r = JSON.parse(l) as RunRecord;
      return r.kind === "autopilot" ? [r] : [];
    } catch {
      return [];
    }
  });
}
