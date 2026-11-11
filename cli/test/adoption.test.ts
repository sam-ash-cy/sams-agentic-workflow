import { expect, test } from "bun:test";
import { adoption, formatAdoption } from "../src/adoption";
import { renderHtml } from "../src/dashboard";
import type { WorkflowEvent } from "../src/events";
import type { TaskMetric } from "../src/metrics";

const ev = (at: string, kind: string, message = "", data?: Record<string, unknown>): WorkflowEvent => ({ at, level: "info", kind, message, ...(data ? { data } : {}) });

const events: WorkflowEvent[] = [
  ev("2026-11-01T10:00:00Z", "nudge", "no saw task open"),
  ev("2026-11-01T10:01:00Z", "guard.deny", "saw guard: routing: no task is open. Use the router skill"),
  ev("2026-11-01T10:02:00Z", "tier", "standard / feature", { tier: "standard", playbook: "feature" }),
  ev("2026-11-01T10:03:00Z", "tier", "retier standard -> complex", { tier: "complex", from: "standard", retier: true }),
  ev("2026-11-01T10:04:00Z", "guard.deny", "saw guard: verify: the complex task is Not verified (not run: test)"),
  ev("2026-11-01T10:05:00Z", "gate.block", "Files were edited but no saw task is open, so nothing was verified."),
  ev("2026-11-01T10:06:00Z", "task.unverified", "complex task closed Not verified: spike", { tier: "complex", label: "Not verified", reason: "spike, thrown away" }),
  ev("2026-11-10T10:00:00Z", "gate.untasked", "stop allowed with no saw task open"),
  ev("2026-11-10T10:01:00Z", "tier", "trivial / debug", { tier: "trivial", playbook: "debug" }),
  ev("2026-11-10T10:02:00Z", "gate.pass", "stop allowed (trivial)", { tier: "trivial" }),
  ev("2026-11-10T10:03:00Z", "subagent.edits", "2 files", { files: ["a.ts", "b.ts"] }),
];

test("adoption counts tasks, Stops, denials, unverified exits, retiers and tiers", () => {
  const a = adoption(events, []);
  expect(a.tasks_opened).toBe(2);
  expect(a.stops).toBe(3);
  expect(a.stops_without_task).toBe(1);
  expect(a.prompts_without_task).toBe(1);
  expect(a.routing_denials).toBe(1);
  expect(a.verify_denials).toBe(1);
  expect(a.untasked_edit_blocks).toBe(1);
  expect(a.retiers).toBe(1);
  expect(a.subagent_edits).toBe(1);
  expect(a.tiers).toEqual({ standard: 1, trivial: 1 });
  expect(a.unverified_exits).toEqual([{ at: "2026-11-01T10:06:00Z", tier: "complex", label: "Not verified", reason: "spike, thrown away" }]);
  expect(a.ratio).toBeCloseTo(2 / 3);
  expect(formatAdoption(a)).toContain("tasks opened        2  (67% of 3 Stops)");
});

test("--since keeps only recent events", () => {
  const a = adoption(events, [], 3, new Date("2026-11-11T00:00:00Z"));
  expect(a.tasks_opened).toBe(1);
  expect(a.routing_denials).toBe(0);
  expect(a.stops).toBe(2);
  expect(a.since).toBe("2026-11-08T00:00:00.000Z");
});

test("with no tier events, finished tasks from metrics count", () => {
  const m = { at: "2026-11-01T00:00:00Z", tier: "complex", playbook: "feature", label: "Verified", first_pass: true, rework: 0, findings: {}, duration_s: 1 } as TaskMetric;
  const a = adoption([], [m]);
  expect(a.tasks_opened).toBe(1);
  expect(a.tiers).toEqual({ complex: 1 });
  expect(a.ratio).toBeUndefined();
});

test("the dashboard shows the adoption card when the panel is on, escaped", () => {
  const evil = ev("2026-11-01T10:06:00Z", "task.unverified", "x", { reason: "<script>" });
  const a = adoption([...events, evil], []);
  const html = renderHtml([], ["adoption"], [], [], new Date(), [], false, a);
  expect(html).toContain("<h2>Adoption</h2>");
  expect(html).toContain("67%");
  expect(html).not.toContain("<script>");
  expect(renderHtml([], ["outcomes"], [], [], new Date(), [], false, a)).not.toContain("<h2>Adoption</h2>");
});
