// `saw split <plan.md>`: an approved plan's independent steps, each in its own
// worktree and branch, to run as parallel sessions. A step is a heading that
// names its branch in backticks (`## Docs \`docs/cost\``); its brief is that
// section, and the rest of the plan is shared context.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const BRANCH = /^(feat|fix|docs|refactor|test|chore|ci|perf|build|style|revert)\/[a-z0-9]+(-[a-z0-9]+)*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const NAMED = /^(.*?)\s*`([^`]+\/[^`]+)`\s*$/;

export interface Unit {
  title: string;
  branch: string;
  brief: string;
}

export interface Split {
  units: Unit[];
  context: string;
  problems: string[];
}

export function parseSplit(md: string): Split {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const units: Unit[] = [];
  const context: string[] = [];
  let open: { unit: Unit; level: number; body: string[] } | undefined;
  const close = (): void => {
    if (open) units.push({ ...open.unit, brief: open.body.join("\n").trim() });
    open = undefined;
  };
  for (const line of lines) {
    const h = HEADING.exec(line);
    if (h && open && h[1]!.length <= open.level) close();
    const named = h ? NAMED.exec(h[2]!) : null;
    if (h && named && !open) {
      open = { unit: { title: named[1]!, branch: named[2]!, brief: "" }, level: h[1]!.length, body: [] };
      continue;
    }
    (open ? open.body : context).push(line);
  }
  close();
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const u of units) {
    if (!BRANCH.test(u.branch)) problems.push(`\`${u.branch}\` (${u.title}) does not follow <type>/<kebab-description>`);
    if (seen.has(u.branch)) problems.push(`\`${u.branch}\` names more than one step`);
    seen.add(u.branch);
  }
  if (units.length < 2) problems.push("a split needs at least two steps, each a heading that names its branch in backticks");
  return { units, context: context.join("\n").trim(), problems };
}

export const planSplit = (s: Split, cwd: string): (Unit & { path: string })[] =>
  s.units.map((u) => ({ ...u, path: join(dirname(cwd), `${basename(cwd)}-${u.branch.split("/")[1]}`) }));

const git = (cwd: string, args: string[]): { ok: boolean; out: string } => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30000 });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
};

// Adds each worktree off origin/<base> (else the local base) and writes its
// brief to .saw/brief.md there. A path that exists is left alone.
export function applySplit(units: (Unit & { path: string })[], context: string, base: string, cwd: string): { unit: Unit & { path: string }; ok: boolean; message: string }[] {
  git(cwd, ["fetch", "--quiet", "origin", base]);
  const from = git(cwd, ["rev-parse", "--verify", "--quiet", `origin/${base}`]).ok ? `origin/${base}` : base;
  return units.map((unit) => {
    if (existsSync(unit.path)) return { unit, ok: false, message: `${unit.path} exists; left alone` };
    const r = git(cwd, ["worktree", "add", "-q", "-b", unit.branch, unit.path, from, "--no-track"]);
    if (!r.ok) return { unit, ok: false, message: `could not add ${unit.path}: ${r.out}` };
    mkdirSync(join(unit.path, ".saw"), { recursive: true });
    writeFileSync(join(unit.path, ".saw", "brief.md"), [`# ${unit.title}`, "", `Branch: \`${unit.branch}\`, off \`${from}\`. Do only this step; the others run in their own worktrees.`, "", unit.brief, "", "## Shared context from the plan", "", context, ""].join("\n"));
    return { unit, ok: true, message: `${unit.path} on ${unit.branch} off ${from}` };
  });
}
