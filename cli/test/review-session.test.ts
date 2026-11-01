import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { guardCommand } from "../src/guard";
import { buildMetric } from "../src/metrics";
import { countFindings, readReviews, recordReview, reviewApplies, reviewArgv, reviewBrief } from "../src/review-session";
import { sessionHook, type SessionHookInput } from "../src/sessions";
import { startTask, taskSteps } from "../src/task";

function config(toml = ""): ReturnType<typeof resolve>["config"] {
  const dir = mkdtempSync(join(tmpdir(), "saw-rev-"));
  writeFileSync(join(dir, "workflow.toml"), toml);
  const none = join(dir, "none.toml");
  return resolve(dir, {}, { global: none, project: join(dir, "workflow.toml"), local: none }).config;
}

const ON = "[review_session]\nenabled = true\n";
const bash = (event: string, command: string): SessionHookInput =>
  ({ hook_event_name: event, session_id: "s1", tool_name: "Bash", tool_input: { command } });
const START = "saw task start --tier complex --playbook feature --unit feature --unit-id login";
const REPORT = "- [missing] cli/src/a.ts:3: flag x is never read\n- [untested] cli/src/b.ts:9: error path\nverdict: fail\n";

test("off by default; on, it applies to the when kinds and skips budget-0 tiers", () => {
  expect(reviewApplies(config(), "feature", "complex")).toBe(false);
  expect(reviewApplies(config(ON), "feature", "complex")).toBe(true);
  expect(reviewApplies(config(ON), "feature", "trivial")).toBe(false);
  expect(reviewApplies(config(ON + 'when = ["phase"]\n'), "feature", "complex")).toBe(false);
  expect(reviewApplies(config(ON + "[review_session.budget_by_tier]\ntrivial = 5000\n"), "feature", "trivial")).toBe(true);
});

test("the brief follows mode, names the plan, blueprint and base branch, and is read-only", () => {
  const cwd = mkdtempSync(join(tmpdir(), "saw-rev-"));
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  writeFileSync(join(cwd, "docs", "plans", "phase-11.md"), "# plan\n");
  writeFileSync(join(cwd, "docs", "BLUEPRINT.md"), "# bp\n");
  const both = reviewBrief(cwd, config(ON), "phase", "phase-11", "complex");
  expect(both).toContain("docs/plans/phase-11.md");
  expect(both).toContain("docs/BLUEPRINT.md");
  expect(both).toContain("git diff main...HEAD");
  expect(both).toContain("Read-only");
  expect(both).toContain("80000 tokens");
  expect(both).toContain("Grill:");
  expect(both).toContain("Audit:");
  const grill = reviewBrief(cwd, config(ON + 'mode = "grill"\n'), "phase", "phase-11", "complex");
  expect(grill).not.toContain("Audit:");
  expect(reviewBrief(cwd, config(ON + 'mode = "audit"\n'), "phase", "x", "complex")).not.toContain("Grill:");
  expect(reviewBrief(cwd, config(ON), "phase", "x", "complex")).toContain("none found");
  expect(reviewArgv("b")).toContain("--disallowedTools");
});

test("records count findings, keep unit ids inside .saw/reviews, and feed the task metric", () => {
  const cwd = mkdtempSync(join(tmpdir(), "saw-rev-"));
  const task = startTask(cwd, "complex", "feature");
  expect(countFindings(REPORT)).toBe(2);
  const rec = recordReview(cwd, "feature", "../../evil", "both", REPORT);
  expect(rec.findings).toBe(2);
  expect(rec.report.startsWith(join(cwd, ".saw", "reviews"))).toBe(true);
  expect(readFileSync(rec.report, "utf8")).toContain("verdict: fail");
  expect(readReviews(cwd)).toHaveLength(1);
  expect(buildMetric(cwd, config(), task).findings.review_session).toBe(2);
});

test("on, gh pr create is denied for a unit until its review is recorded; off, it isn't", () => {
  const cwd = mkdtempSync(join(tmpdir(), "saw-rev-"));
  startTask(cwd, "complex", "feature");
  const cfg = config(ON);
  sessionHook(cwd, cfg, bash("PostToolUse", START));
  const out = sessionHook(cwd, cfg, bash("PreToolUse", "gh pr create --fill")) as { hookSpecificOutput: Record<string, string> };
  expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(out.hookSpecificOutput.permissionDecisionReason).toContain("saw review-session run --unit feature --unit-id login");
  recordReview(cwd, "feature", "login", "both", REPORT);
  expect(sessionHook(cwd, cfg, bash("PreToolUse", "gh pr create --fill"))).toBeUndefined();

  const off = mkdtempSync(join(tmpdir(), "saw-rev-"));
  sessionHook(off, config(), bash("PostToolUse", START));
  expect(sessionHook(off, config(), bash("PreToolUse", "gh pr create --fill"))).toBeUndefined();
});

test("the gate still tracks the unit when [sessions] new_per is []", () => {
  const cwd = mkdtempSync(join(tmpdir(), "saw-rev-"));
  const cfg = config(ON + "[sessions]\nnew_per = []\n");
  sessionHook(cwd, cfg, bash("PostToolUse", START));
  const out = sessionHook(cwd, cfg, bash("PreToolUse", "gh pr create")) as { hookSpecificOutput: Record<string, string> };
  expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
});

test("a trivial task skips the gate and the step", () => {
  const cwd = mkdtempSync(join(tmpdir(), "saw-rev-"));
  startTask(cwd, "trivial", "feature");
  sessionHook(cwd, config(ON), bash("PostToolUse", START));
  expect(sessionHook(cwd, config(ON), bash("PreToolUse", "gh pr create"))).toBeUndefined();
  expect(taskSteps(config(ON), "trivial").join(" ")).not.toContain("review session");
  expect(taskSteps(config(ON), "complex").join(" ")).toContain("review session for a feature/phase/stage unit");
  expect(taskSteps(config(), "complex").join(" ")).not.toContain("review session");
});

test("guard: review-session run is a spawn_sessions action, not blocked by parallel_sessions", () => {
  expect(guardCommand(config(), "saw review-session run --unit phase --unit-id p")?.decision).toBe("ask");
  expect(guardCommand(config("[autonomy.actions]\nspawn_sessions = \"allow\"\n"), "saw review-session run --unit phase --unit-id p")).toBeUndefined();
  expect(guardCommand(config("[autonomy.actions]\nspawn_sessions = \"never\"\n"), "saw review-session run --unit phase --unit-id p")?.decision).toBe("deny");
  expect(guardCommand(config(), "saw review-session run --dry-run --unit phase --unit-id p")).toBeUndefined();
});

test("the CLI: off fails, brief prints, record records, run --dry-run spawns nothing", async () => {
  const { run } = await import("../src/main");
  const cwd = mkdtempSync(join(tmpdir(), "saw-rev-"));
  writeFileSync(join(cwd, "workflow.toml"), "");
  const args = ["--unit", "phase", "--unit-id", "p1"];
  expect(await run(["review-session", "brief", ...args], cwd)).toBe(1);
  writeFileSync(join(cwd, "workflow.toml"), ON);
  expect(await run(["review-session", "brief", ...args], cwd)).toBe(0);
  expect(await run(["review-session", "brief", "--unit", "epic", "--unit-id", "p1"], cwd)).toBe(1);
  expect(await run(["review-session", "run", "--dry-run", ...args], cwd)).toBe(0);
  expect(readReviews(cwd)).toHaveLength(0);
  writeFileSync(join(cwd, "r.md"), REPORT);
  expect(await run(["review-session", "record", join(cwd, "r.md"), ...args], cwd)).toBe(0);
  expect(readReviews(cwd)[0]!.findings).toBe(2);
});
