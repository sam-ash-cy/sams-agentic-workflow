import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULTS } from "../src/defaults";
import type { Session } from "../src/autopilot";
import { cycles, parsePlanItems, plan, planArgv, planBrief, renderItem, revertApprovals, validateQueue, type PlanDeps } from "../src/plan";

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

function deps(onRun: () => void = () => {}): PlanDeps & { calls: string[][]; logs: string[] } {
  const d = {
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
