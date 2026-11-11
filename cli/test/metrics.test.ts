import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { buildPanels, renderHtml, renderMarkdown } from "../src/dashboard";
import { appendMetric, buildMetric, readMetrics, transcriptTokens, type TaskMetric } from "../src/metrics";
import { currentTask, gate, recordCheck, startTask } from "../src/task";

function project(toml: string): { dir: string; config: ReturnType<typeof resolve>["config"] } {
  const dir = mkdtempSync(join(tmpdir(), "saw-metrics-"));
  writeFileSync(join(dir, "workflow.toml"), toml);
  const none = join(dir, "none.toml");
  return { dir, config: resolve(dir, {}, { global: none, project: join(dir, "workflow.toml"), local: none }).config };
}

const TOML = '[checks]\ntest = "echo ok"\n[verify.standard]\nrun = ["test", "code_review"]';

test("a task's metric counts rework, findings and first pass", () => {
  const { dir, config } = project(TOML);
  const task = startTask(dir, "standard", "feature");
  recordCheck(dir, { name: "test", status: "fail", how: "ran" });
  recordCheck(dir, { name: "test", status: "pass", how: "ran" });
  recordCheck(dir, { name: "code_review", status: "pass", how: "recorded" });
  const m = buildMetric(dir, config, task, 1234, new Date(Date.parse(task.started) + 90_000));
  expect(m).toMatchObject({ label: "Verified", first_pass: false, rework: 1, findings: { test: 1 }, duration_s: 90, tokens: 1234, tokens_source: "flag" });
  appendMetric(dir, m);
  writeFileSync(join(dir, ".saw", "metrics.jsonl"), readMetrics(dir).map((x) => JSON.stringify(x)).join("\n") + "\n{broken\n");
  expect(readMetrics(dir).length).toBe(1); // a corrupt line is skipped, not fatal
});

test("the Stop hook saves the transcript, and tokens are summed from entries after the task started", () => {
  const { dir, config } = project(TOML);
  const transcript = join(dir, "t.jsonl");
  const task = startTask(dir, "standard", "feature");
  const before = new Date(Date.parse(task.started) - 1000).toISOString();
  const after = new Date(Date.parse(task.started) + 1000).toISOString();
  writeFileSync(
    transcript,
    [
      { timestamp: before, message: { usage: { input_tokens: 999 } } },
      { timestamp: after, message: { usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5 } } },
      { timestamp: after, type: "user" },
    ].map((x) => JSON.stringify(x)).join("\n") + "\n{partial",
  );
  gate(dir, config, { transcript_path: transcript });
  expect(currentTask(dir)?.transcript).toBe(transcript);
  expect(transcriptTokens(transcript, task.started)).toBe(125);
  expect(buildMetric(dir, config, currentTask(dir)!)).toMatchObject({ tokens: 125, tokens_source: "transcript" });
  expect(transcriptTokens(join(dir, "missing.jsonl"), task.started)).toBeUndefined();
});

test("the gate phases in debugging after a check fails twice", () => {
  const { dir, config } = project(TOML);
  startTask(dir, "standard", "feature");
  recordCheck(dir, { name: "test", status: "fail", how: "ran" });
  expect(gate(dir, config, {})?.reason).not.toContain("debug playbook");
  recordCheck(dir, { name: "test", status: "fail", how: "ran" });
  expect(gate(dir, config, {})?.reason).toContain("test failed more than once: switch to the debug playbook");
  recordCheck(dir, { name: "test", status: "pass", how: "ran" });
  expect(gate(dir, config, {})?.reason).not.toContain("debug playbook"); // fixed since: no hint
  startTask(dir, "standard", "debug");
  recordCheck(dir, { name: "test", status: "fail", how: "ran" });
  recordCheck(dir, { name: "test", status: "fail", how: "ran" });
  expect(gate(dir, config, {})?.reason).not.toContain("switch to the debug playbook");
});

test("dashboard panels aggregate by tier and render safely", () => {
  const base: TaskMetric = { at: "", tier: "standard", playbook: "feature", label: "Verified", first_pass: true, rework: 0, findings: {}, duration_s: 1 };
  const ms: TaskMetric[] = [
    { ...base, tokens: 100 },
    { ...base, first_pass: false, rework: 2, findings: { lint: 2 }, tokens: 300 },
    { ...base, tier: "trivial", label: "Blocked", first_pass: false, playbook: "<script>" },
  ];
  const [fp, rework, cost, findings] = buildPanels(ms, ["first_pass_rate", "rework", "cost_per_task", "findings_by_category", "nope"]);
  expect(fp!.bars).toEqual([
    { label: "trivial (1)", value: 0, text: "0%" },
    { label: "standard (2)", value: 0.5, text: "50%" },
  ]);
  expect(rework!.bars.find((b) => b.label.startsWith("standard"))?.text).toBe("1.0");
  expect(cost!.bars).toEqual([{ label: "standard (2)", value: 200, text: "200" }]);
  expect(findings!.bars).toEqual([{ label: "lint", value: 2, text: "2" }]);

  const html = renderHtml(ms, ["outcomes", "promotion_effect"]);
  expect(html).not.toContain("<script");
  expect(html).toContain("No data yet.");
  expect(renderHtml([], ["first_pass_rate"])).toContain("No data yet.");
  expect(renderMarkdown(ms, ["findings_by_category"])).toContain("| lint | 2 |");
});

test("dashboard paths must stay inside the project, and --tokens needs a number", async () => {
  const { run } = await import("../src/main");
  const { dir } = project('[dashboard]\nobsidian_note = "../escape.md"');
  expect(run(["dashboard"], dir)).toBe(1);
  const ok = project('[verify]\nallow_unconfigured = ["test"]');
  expect(run(["dashboard"], ok.dir)).toBe(0);
  startTask(ok.dir, "trivial", "feature");
  expect(run(["task", "end", "--tokens", ""], ok.dir)).toBe(1);
  expect(run(["task", "end", "--tokens", "500"], ok.dir)).toBe(0);
  expect(readMetrics(ok.dir)[0]?.tokens).toBe(500);
});
