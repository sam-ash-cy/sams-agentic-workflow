import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderHtml } from "../src/dashboard";
import { compare, summarise } from "../src/evals";
import type { TaskMetric } from "../src/metrics";
import { candidates, readProposals, retro } from "../src/retro";

const base: TaskMetric = { at: "2026-10-01T00:00:00Z", tier: "standard", playbook: "feature", label: "Verified", first_pass: true, rework: 0, findings: {}, duration_s: 1 };
const failed = (check: string, at: string): TaskMetric => ({ ...base, at, first_pass: false, rework: 1, findings: { [check]: 1 } });

test("a check failing in enough tasks becomes one proposal, written once", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "saw-retro-")), "docs", "proposals");
  const ms = [failed("lint", "2026-10-01T00:00:00Z"), failed("lint", "2026-10-02T00:00:00Z"), failed("test", "2026-10-02T00:00:00Z"), base];
  expect(candidates(ms, 2).map((c) => c.check)).toEqual(["lint"]);

  expect(retro(dir, ms, 2, false).written).toEqual([]); // suggest mode: nothing written
  const first = retro(dir, ms, 2, true, "2026-10-03");
  expect(first.written).toEqual(["0001-lint.md"]);
  expect(readFileSync(join(dir, "0001-lint.md"), "utf8")).toContain("Failed in 2 tasks");
  const again = retro(dir, ms, 2, true);
  expect(again.written).toEqual([]);
  expect(again.open.map((p) => p.check)).toEqual(["lint"]);

  // A rejected proposal doesn't block a new one; numbering continues.
  writeFileSync(join(dir, "0001-lint.md"), "---\ncheck: lint\nstatus: rejected\n---\n");
  expect(retro(dir, ms, 2, true).written).toEqual(["0002-lint.md"]);
});

test("promotion_effect compares the failure rate before and after the fix", () => {
  const dir = mkdtempSync(join(tmpdir(), "saw-promo-"));
  writeFileSync(join(dir, "0001-lint.md"), "---\r\ncheck: lint\r\nstatus: promoted\r\npromoted: 2026-10-10\r\n---\r\n");
  const proposals = readProposals(dir);
  expect(proposals).toEqual([{ file: "0001-lint.md", check: "lint", status: "promoted", promoted: "2026-10-10" }]);
  const ms = [failed("lint", "2026-10-01T00:00:00Z"), base, { ...base, at: "2026-10-11T00:00:00Z" }, failed("lint", "2026-10-12T00:00:00Z")];
  const html = renderHtml(ms, ["promotion_effect"], proposals);
  expect(html).toContain("50% → 50%");
  expect(renderHtml(ms, ["promotion_effect"], [])).toContain("No data yet.");
});

test("eval results are summarised tolerantly and compared case by case", () => {
  const raw = { suite: "x", cases: [{ name: "a", score: 1, tokens: 1000 }, { case: "b", mean_score: 0.67, usage: { total_tokens: 500 } }, { note: "no score" }] };
  const before = summarise(raw);
  expect(before).toEqual({ a: { score: 1, tokens: 1000 }, b: { score: 0.67, tokens: 500 } });

  expect(compare(before, before, 0.1).regressions).toEqual([]);
  const worse = compare(before, { a: { score: 0.67, tokens: 900 }, b: { score: 0.67, tokens: 600 } }, 0.1);
  expect(worse.regressions).toEqual(["a: score 1.00 -> 0.67", "b: tokens +20% at the same score"]);
  const mixed = compare(before, { b: { score: 1, tokens: 5000 } }, 0.1);
  expect(mixed).toEqual({ regressions: [], improvements: ["b: score 0.67 -> 1.00"], missing: ["a"] });
});

test("saw retro and saw eval compare from the CLI", async () => {
  const { run } = await import("../src/main");
  const dir = mkdtempSync(join(tmpdir(), "saw-cli7-"));
  writeFileSync(join(dir, "workflow.toml"), "");
  const a = join(dir, "a.json");
  const b = join(dir, "b.json");
  writeFileSync(a, JSON.stringify([{ name: "x", score: 1 }]));
  writeFileSync(b, JSON.stringify([{ name: "x", score: 0.5 }]));
  expect(run(["eval", "compare", a, a], dir)).toBe(0);
  expect(run(["eval", "compare", a, b], dir)).toBe(1);
  expect(run(["retro"], dir)).toBe(0);
  writeFileSync(join(dir, "workflow.toml"), '[retro]\nproposals_dir = "../out"');
  expect(run(["retro"], dir)).toBe(1);
});
