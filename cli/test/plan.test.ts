import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULTS } from "../src/defaults";
import type { Session } from "../src/autopilot";
import { cycles, maxUsd, outsideDocs, parsePlanItems, plan, planArgv, planBrief, renderItem, revertApprovals, validateQueue, type PlanDeps } from "../src/plan";

const GOOD = `# Queue

- [done] old: shipped
- [proposed] api: report API
  - tier: standard
  - accept: GET /reports returns JSON
  - adr: docs/decisions/0001-api.md
- [proposed] csv: CSV export
  - tier: trivial
  - needs: api
  - accept: button exists
  - accept: file downloads
`;

test("renderItem round-trips through parsePlanItems", () => {
  const item = { status: "proposed", slug: "csv", text: "CSV export", tier: "standard", needs: ["api", "auth"], accept: ["a", "b"], adr: "docs/decisions/0002-csv.md" };
  const text = renderItem(item);
  expect(text).toBe("- [proposed] csv: CSV export\n  - tier: standard\n  - needs: api, auth\n  - accept: a\n  - accept: b\n  - adr: docs/decisions/0002-csv.md");
  const [parsed] = parsePlanItems(text);
  expect({ ...parsed, line: undefined }).toEqual({ ...item, line: undefined });
});

test("a valid queue has no problems", () => {
  expect(validateQueue(parsePlanItems(GOOD))).toEqual([]);
});

test("unknown slug in needs", () => {
  expect(validateQueue(parsePlanItems(GOOD.replace("needs: api", "needs: api, ghost")))).toEqual(["csv: needs unknown slug ghost"]);
});

test("dependency cycle", () => {
  const q = GOOD.replace("  - tier: standard\n", "  - tier: standard\n  - needs: csv\n");
  expect(cycles(parsePlanItems(q))).toEqual([["api", "csv", "api"]]);
  expect(validateQueue(parsePlanItems(q))).toEqual(["dependency cycle: api -> csv -> api"]);
});

test("duplicate slug", () => {
  expect(validateQueue(parsePlanItems(GOOD + "- [done] api: again\n"))).toEqual(["duplicate slug: api (line 13)"]);
});

test("missing tier and unknown tier", () => {
  expect(validateQueue(parsePlanItems(GOOD.replace("  - tier: trivial\n", "")))).toEqual(["csv: missing tier"]);
  expect(validateQueue(parsePlanItems(GOOD.replace("tier: trivial", "tier: huge")))).toEqual(["csv: unknown tier huge"]);
});

test("item with no accept line", () => {
  expect(validateQueue(parsePlanItems(GOOD.replace("  - accept: GET /reports returns JSON\n", "")))).toEqual(["api: no accept line"]);
});

test("revertApprovals puts back only approvals the session added", () => {
  const before = "- [approved] keep: owner approved\n";
  const after = before + "- [approved] sneaky: added\n  - tier: trivial\n- [Approved] loud: added\n";
  const { text, reverted } = revertApprovals(before, after);
  expect(reverted).toEqual(["sneaky", "loud"]);
  expect(text).toBe("- [approved] keep: owner approved\n- [proposed] sneaky: added\n  - tier: trivial\n- [proposed] loud: added\n");
});

test("planArgv blocks commits and pushes and puts the cap on", () => {
  const argv = planArgv("id-1", 3);
  expect(argv.slice(0, 7)).toEqual(["claude", "-p", "--session-id", "id-1", "--max-budget-usd", "3", "--output-format"]);
  const tools = argv[argv.indexOf("--disallowedTools") + 1];
  expect(tools).toContain("Bash(git commit:*)");
  expect(tools).toContain("Bash(git push:*)");
});

test("the shipped brief names the goal, queue and rules", () => {
  const b = planBrief("ship CSV", "docs/plans/queue.md");
  expect(b).toContain("ship CSV");
  expect(b).toContain("docs/plans/queue.md");
  expect(b).toContain("status: proposed");
  expect(b).toContain("never write `[approved]`");
});

function setup(queue: string): { dir: string; q: string } {
  const dir = mkdtempSync(join(tmpdir(), "saw-plan-"));
  mkdirSync(join(dir, "docs", "plans"), { recursive: true });
  const q = join(dir, "docs", "plans", "queue.md");
  writeFileSync(q, queue);
  return { dir, q };
}

function deps(onRun: () => void = () => {}, changed: string[][] = [[], []]): PlanDeps & { calls: string[][]; logs: string[] } {
  const d = {
    changed: () => changed.shift() ?? [],
    calls: [] as string[][],
    logs: [] as string[],
    uuid: () => "uuid-1",
    log: (l: string) => d.logs.push(l),
    claude: (argv: string[]): Session => {
      d.calls.push(argv);
      onRun();
      return { code: 0, cost_usd: 1.5, is_error: false, text: "planned" };
    },
  };
  return d;
}

test("dry run prints the brief and spawns nothing", () => {
  const { dir, q } = setup("");
  const d = deps();
  expect(plan(dir, DEFAULTS, "ship CSV", q, d, { dryRun: true })).toBe(0);
  expect(d.calls).toEqual([]);
  expect(d.logs.join("\n")).toContain("would run: claude -p --session-id uuid-1");
  expect(d.logs.join("\n")).toContain("ship CSV");
});

test("a run reverts added approvals and passes a valid queue", () => {
  const { dir, q } = setup("# Queue\n");
  mkdirSync(join(dir, "docs", "decisions"), { recursive: true });
  writeFileSync(join(dir, "docs", "decisions", "0001-api.md"), "status: proposed\n");
  const d = deps(() => writeFileSync(q, GOOD.replace("[proposed] csv", "[approved] csv")));
  expect(plan(dir, DEFAULTS, "ship CSV", q, d)).toBe(0);
  expect(d.calls.length).toBe(1);
  expect(readFileSync(q, "utf8")).toBe(GOOD);
  expect(d.logs.some((l) => l.includes("set back to [proposed]") && l.includes("csv"))).toBe(true);
});

test("a run with an invalid queue exits non-zero and lists problems", () => {
  const { dir, q } = setup("");
  const d = deps(() => writeFileSync(q, GOOD.replace("needs: api", "needs: ghost")));
  expect(plan(dir, DEFAULTS, "ship CSV", q, d)).toBe(1);
  expect(d.logs).toContain("problem: csv: needs unknown slug ghost");
});

test("indented approvals are reverted too (autopilot reads them)", () => {
  const { text, reverted } = revertApprovals("", "  - [approved] evil: run me\n");
  expect(reverted).toEqual(["evil"]);
  expect(text).toBe("  - [proposed] evil: run me\n");
  expect(parsePlanItems("  - [proposed] x: y\n    - tier: trivial\n")[0].tier).toBe("trivial");
});

test("a rewritten or duplicated approved item is reverted", () => {
  const before = "- [approved] foo: small fix\n  - accept: works\n";
  expect(revertApprovals(before, before).reverted).toEqual([]);
  expect(revertApprovals(before, "- [approved] foo: delete prod\n  - accept: works\n").reverted).toEqual(["foo"]);
  expect(revertApprovals(before, before.replace("works", "anything")).reverted).toEqual(["foo"]);
  const dup = revertApprovals(before, before + before);
  expect(dup.reverted).toEqual(["foo"]);
  expect(dup.text).toBe(before + before.replace("[approved]", "[proposed]"));
});

test("planBrief keeps $ patterns and {{queue}} in the goal literal", () => {
  expect(planBrief("cost $& and {{queue}}", "q.md", "G={{goal}} Q={{queue}}")).toBe("G=cost $& and {{queue}} Q=q.md");
});

test("a bad max_usd is refused", () => {
  expect(maxUsd({ plan: { max_usd: 2 } })).toBe(2);
  expect(() => maxUsd({ plan: { max_usd: "lots" } })).toThrow();
  expect(() => maxUsd({ plan: { max_usd: 0 } })).toThrow();
  const { dir, q } = setup("");
  const d = deps();
  expect(plan(dir, { ...DEFAULTS, plan: { max_usd: -1 } }, "g", q, d)).toBe(1);
  expect(d.calls).toEqual([]);
});

test("planArgv allows only reading and docs edits", () => {
  const argv = planArgv("id", 3, "main", "plans/queue.md");
  const allowed = argv[argv.indexOf("--allowedTools") + 1];
  expect(allowed).toBe("Read,Grep,Glob,Edit(docs/**),Write(docs/**),Edit(plans/queue.md),Write(plans/queue.md)");
  expect(argv[argv.indexOf("--disallowedTools") + 1].split(",")).toContain("Bash");
});

test("outsideDocs flags new changes outside docs/ only", () => {
  expect(outsideDocs(["src/old.ts"], ["src/old.ts", "docs/x.md", "plans/q.md", "cli\\src\\a.ts"], "plans/q.md")).toEqual(["cli/src/a.ts"]);
});

test("a run that edits code, cites a missing ADR or fails says so", () => {
  const { dir, q } = setup("");
  const d = deps(() => writeFileSync(q, GOOD), [[], ["cli/src/x.ts"]]);
  d.claude = (argv) => {
    d.calls.push(argv);
    writeFileSync(q, GOOD);
    return { code: 1, cost_usd: 0.1, is_error: true, text: "budget exceeded" };
  };
  expect(plan(dir, DEFAULTS, "g", q, d)).toBe(1);
  expect(d.logs).toContain("session said: budget exceeded");
  expect(d.logs).toContain("problem: changed outside docs/: cli/src/x.ts (review and revert it)");
  expect(d.logs).toContain("problem: api: adr not found: docs/decisions/0001-api.md");
});
