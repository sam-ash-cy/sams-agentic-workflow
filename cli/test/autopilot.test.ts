import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import type { Table } from "../src/defaults";
import { autopilot, claudeArgv, disallowed, durationMs, eligible, itemBrief, opensPr, parseQueue, readRuns, readState, resetAt, scheduleCommand, waitMs, type Deps, type Session } from "../src/autopilot";
import { renderHtml } from "../src/dashboard";
import { readMetrics } from "../src/metrics";

function project(toml: string, queue: string): { dir: string; config: Table } {
  const dir = mkdtempSync(join(tmpdir(), "saw-ap-"));
  writeFileSync(join(dir, "workflow.toml"), toml);
  mkdirSync(join(dir, "docs", "plans"), { recursive: true });
  writeFileSync(join(dir, "docs", "plans", "queue.md"), queue);
  const none = join(dir, "none.toml");
  // The owner's own layer: a committed workflow.toml can't loosen autonomy (config.ts).
  return { dir, config: resolve(dir, {}, { global: none, project: none, local: join(dir, "workflow.toml") }).config };
}

const QUEUE = "# Queue\n\n- [approved] login: add login\n- [proposed] export: CSV export\n- [approved] search: full-text search\n- [done] old: shipped\n";
const ON = "[autopilot]\nenabled = true\n";

function fakeDeps(sessions: Session[]): Deps & { prompts: string[]; argvs: string[][]; gits: string[][]; ghs: string[][]; slept: number[]; logs: string[] } {
  let t = Date.parse("2026-11-01T10:00:00Z");
  let n = 0;
  const d = {
    argvs: [] as string[][],
    gits: [] as string[][],
    ghs: [] as string[][],
    slept: [] as number[],
    logs: [] as string[],
    prompts: [] as string[],
    claude: (argv: string[], prompt: string): Session => {
      d.prompts.push(prompt);
      d.argvs.push(argv);
      return sessions.shift() ?? { code: 0, cost_usd: 1, is_error: false, text: "done" };
    },
    gh: (a: string[]) => {
      d.ghs.push(a);
      return { code: 0, out: "https://github.com/o/r/pull/1\n" };
    },
    git: (a: string[]) => {
      d.gits.push(a);
      return { code: 0, out: "" };
    },
    sleep: (ms: number) => {
      d.slept.push(ms);
      t += ms;
    },
    now: () => new Date(t),
    uuid: () => `id-${++n}`,
    log: (l: string) => d.logs.push(l),
  };
  return d;
}

test("parseQueue reads items; only owner-approved ones not yet done are eligible", () => {
  const items = parseQueue(QUEUE);
  expect(items.map((i) => `${i.status}:${i.slug}`)).toEqual(["approved:login", "proposed:export", "approved:search", "done:old"]);
  expect(eligible(items, { spent_usd: 0, failures: 0, done: { login: "pr" } }).map((i) => i.slug)).toEqual(["search"]);
});

test("durations, reset times and backoff", () => {
  expect(durationMs("6h")).toBe(6 * 3600_000);
  expect(durationMs("90m")).toBe(90 * 60_000);
  expect(() => durationMs("soon")).toThrow("max_wait");
  const now = new Date(2026, 10, 1, 10, 0);
  expect(resetAt("Claude AI usage limit reached|1793530800", now)?.getTime()).toBe(1793530800_000);
  expect(resetAt("5-hour limit reached ∙ resets 3pm", now)?.getHours()).toBe(15);
  expect(resetAt("limit reached, resets 9am", now)?.getDate()).toBe(2);
  expect(resetAt("rate limit", now)).toBeUndefined();
  expect(waitMs("rate limit", now, 0, "6h")).toBe(15 * 60_000);
  expect(waitMs("rate limit", now, 2, "6h")).toBe(60 * 60_000);
  expect(waitMs("rate limit", now, 10, "6h")).toBe(6 * 3600_000);
});

test("each item gets its own branch and fresh session under the per-item cap; never merge", () => {
  const { dir, config } = project(`${ON}per_item_usd = 3\n`, QUEUE);
  const d = fakeDeps([]);
  expect(autopilot(dir, config, [], d)).toBe(0);
  expect(d.gits).toContainEqual(["switch", "-c", "autopilot/login", "main"]);
  expect(d.gits).toContainEqual(["switch", "-c", "autopilot/search", "main"]);
  expect(d.argvs).toHaveLength(2);
  expect(d.argvs[0]).toEqual(claudeArgv("id-1", 3, false, "main"));
  expect(d.prompts[0]).toContain("Autopilot item login: add login");
  expect(d.argvs[0]!.join(" ")).not.toContain("\n");
  expect(d.argvs[0]).toContain("--max-budget-usd");
  expect(d.argvs[0]!.join(" ")).toContain("gh pr merge");
  expect(disallowed("main").some((x) => x.includes("git merge"))).toBe(true);
  expect(readState(dir).done).toEqual({ login: "pr", search: "pr" });
  expect(d.logs.at(-1)).toContain("queue empty");
  // The queue file is the owner's: never written.
  expect(readFileSync(join(dir, "docs", "plans", "queue.md"), "utf8")).toBe(QUEUE);
});

const PR_ON = '[safety]\npush = "allow"\n[autonomy.actions]\nopen_pr = "allow"\npush = "allow"\n';

test("the session only commits; the runner opens the PR only when open_pr and push allow it", () => {
  const item = { status: "approved", slug: "x", text: "do x" };
  expect(opensPr(project("", "").config)).toBe(false);
  expect(opensPr(project('[autonomy.actions]\nopen_pr = "allow"\n', "").config)).toBe(false);
  expect(itemBrief(project("", "").config, item, "autopilot/x")).toContain("The owner opens the PR");
  expect(itemBrief(project(PR_ON, "").config, item, "autopilot/x")).toContain("The runner pushes the branch");

  const on = project(`${ON}[repo.protect]\nbranch = "trunk"\n${PR_ON}`, "- [approved] x: do x\n");
  const d = fakeDeps([]);
  // safety.push = "allow" alone doesn't trip the weakened-guardrail stop.
  expect(autopilot(on.dir, on.config, ['safety.push = "allow" (from local)'], d)).toBe(0);
  expect(d.gits).toContainEqual(["push", "-u", "origin", "autopilot/x"]);
  expect(d.ghs[0]).toEqual(expect.arrayContaining(["pr", "create", "--base", "trunk", "--head", "autopilot/x"]));
  expect(d.gits.some((g) => g.includes("trunk") && g[0] === "push")).toBe(false);
  expect(d.ghs.flat()).not.toContain("merge");

  const off = project(ON, "- [approved] x: do x\n");
  const d2 = fakeDeps([]);
  autopilot(off.dir, off.config, [], d2);
  expect(d2.gits.some((g) => g[0] === "push")).toBe(false);
  expect(d2.ghs).toEqual([]);
});

test("a usage limit saves state, waits for the reset and resumes the same session", () => {
  const { dir, config } = project(ON, "- [approved] login: add login\n");
  const d = fakeDeps([{ code: 1, cost_usd: 0.5, is_error: true, text: "usage limit reached|" + Math.floor(Date.parse("2026-11-01T12:00:00Z") / 1000) }]);
  expect(autopilot(dir, config, [], d)).toBe(0);
  expect(d.slept).toEqual([2 * 3600_000 + 60_000]);
  expect(d.argvs[1]).toContain("--resume");
  expect(d.argvs[1]).toContain("id-1");
  expect(readState(dir).spent_usd).toBe(1.5);
  expect(readRuns(dir).map((r) => r.outcome)).toEqual(["waiting", "pr"]);
  // Task metrics and the dashboard keep autopilot records apart.
  expect(readMetrics(dir)).toEqual([]);
  expect(renderHtml([], ["autopilot"], [], readRuns(dir))).toContain("limit waits");
});

test("resume_on_limit = false restarts the item in a new session", () => {
  const { dir, config } = project(`${ON}resume_on_limit = false\n`, "- [approved] login: x\n");
  const d = fakeDeps([{ code: 1, cost_usd: 0, is_error: true, text: "rate limit exceeded" }]);
  autopilot(dir, config, [], d);
  expect(d.slept).toEqual([15 * 60_000]);
  expect(d.argvs[1]).toContain("--session-id");
  expect(d.argvs[1]).toContain("id-2");
});

test("restarting continues from saved state (idempotent)", () => {
  const { dir, config } = project(ON, "- [approved] login: x\n");
  mkdirSync(join(dir, ".saw"), { recursive: true });
  writeFileSync(join(dir, ".saw", "autopilot.json"), JSON.stringify({ spent_usd: 2, failures: 0, done: {}, current: { slug: "login", branch: "autopilot/login", session_id: "abc", waits: 1 } }));
  const d = fakeDeps([]);
  autopilot(dir, config, [], d);
  expect(d.gits.some((g) => g[1] === "-c")).toBe(false);
  expect(d.argvs[0]).toContain("abc");
  expect(d.argvs[0]).toContain("--resume");
});

test("Blocked items are parked; max_failures in a row stops the runner", () => {
  const { dir, config } = project(`${ON}max_failures = 2\n`, "- [approved] a: x\n- [approved] b: y\n- [approved] c: z\n");
  const d = fakeDeps([
    { code: 0, cost_usd: 1, is_error: false, text: "work...\nBlocked: needs a decision" },
    { code: 1, cost_usd: 1, is_error: true, text: "crashed" },
  ]);
  expect(autopilot(dir, config, [], d)).toBe(1);
  expect(readState(dir).done).toEqual({ a: "parked", b: "parked" });
  expect(d.logs.at(-1)).toContain("max_failures");
  expect(d.argvs).toHaveLength(2);
});

test("stops: disabled, total budget, STOP file, weakened safety, dirty tree", () => {
  const q = "- [approved] a: x\n";
  const off = project("", q);
  expect(autopilot(off.dir, off.config, [], fakeDeps([]))).toBe(1);

  const cap = project(`${ON}max_total_usd = 1.5\n`, "- [approved] a: x\n- [approved] b: y\n");
  const d = fakeDeps([]);
  expect(autopilot(cap.dir, cap.config, [], d)).toBe(1);
  expect(d.argvs).toHaveLength(2);
  expect(d.logs.at(-1)).toContain("max_total_usd");

  const stop = project(ON, q);
  mkdirSync(join(stop.dir, ".saw"), { recursive: true });
  writeFileSync(join(stop.dir, ".saw", "STOP"), "");
  const ds = fakeDeps([]);
  expect(autopilot(stop.dir, stop.config, [], ds)).toBe(1);
  expect(ds.argvs).toHaveLength(0);

  const weak = project(ON, q);
  const dw = fakeDeps([]);
  expect(autopilot(weak.dir, weak.config, ['safety.no_secrets = false (from local)'], dw)).toBe(1);
  expect(dw.logs[0]).toContain("weakened guardrail");

  const dirty = project(ON, q);
  const dd = fakeDeps([]);
  dd.git = (a) => ({ code: 0, out: a[0] === "status" ? " M file.ts\n" : "" });
  expect(autopilot(dirty.dir, dirty.config, [], dd)).toBe(1);
  expect(dd.argvs).toHaveLength(0);
  expect(existsSync(join(dirty.dir, ".saw", "autopilot.json"))).toBe(false);
});

test("--install-schedule prints a command per platform", () => {
  expect(scheduleCommand("C:\\p", "win32")).toContain("schtasks /Create");
  expect(scheduleCommand("/p", "linux")).toContain("crontab");
  expect(scheduleCommand("/p", "darwin")).toContain("launchd");
});

test("review fixes: budget stop isn't a limit, resume switches back, no stale branch reuse, base-aware backstop", () => {
  const a = project(ON, "- [approved] x: do x\n");
  const d = fakeDeps([{ code: 1, cost_usd: 5, is_error: true, text: "Budget limit exceeded (--max-budget-usd 5)" }]);
  autopilot(a.dir, a.config, [], d);
  expect(d.slept).toEqual([]);
  expect(readState(a.dir).done).toEqual({ x: "parked" });

  const b = project(ON, "- [approved] login: x\n");
  mkdirSync(join(b.dir, ".saw"), { recursive: true });
  writeFileSync(join(b.dir, ".saw", "autopilot.json"), JSON.stringify({ spent_usd: 0, failures: 0, done: {}, current: { slug: "login", branch: "autopilot/login", session_id: "abc", waits: 1 } }));
  const db = fakeDeps([]);
  autopilot(b.dir, b.config, [], db);
  expect(db.gits[0]).toEqual(["switch", "autopilot/login"]);

  const c = project(ON, "- [approved] x: do x\n");
  const dc = fakeDeps([]);
  dc.git = (g) => ({ code: g[1] === "-c" ? 128 : 0, out: g[1] === "-c" ? "fatal: a branch named 'autopilot/x' already exists" : "" });
  expect(autopilot(c.dir, c.config, [], dc)).toBe(1);
  expect(dc.argvs).toHaveLength(0);

  expect(disallowed("trunk")).toEqual(expect.arrayContaining(["Bash(git push origin trunk:*)", "Bash(git push origin HEAD:trunk:*)", "Bash(git push origin HEAD:main:*)"]));
});
