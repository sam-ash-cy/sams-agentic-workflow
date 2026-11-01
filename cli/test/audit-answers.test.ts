import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { depAuditFor, init, uninstall, upgrade } from "../src/init";
import { outline } from "../src/outline";
import { applyPlan, repoPlan, type Gh, type State } from "../src/repo";
import { changedTests } from "../src/run";
import { taskSteps } from "../src/task";

const tmp = (p: string): string => mkdtempSync(join(tmpdir(), p));

function config(toml = ""): ReturnType<typeof resolve>["config"] {
  const dir = tmp("saw-ans-");
  writeFileSync(join(dir, "workflow.toml"), toml);
  const none = join(dir, "none.toml");
  return resolve(dir, {}, { global: none, project: join(dir, "workflow.toml"), local: none }).config;
}

function templates(): string {
  const t = tmp("saw-tpl-");
  writeFileSync(join(t, "a.md"), "v1\n");
  writeFileSync(join(t, "b.md"), "b\n");
  return t;
}

test("uninstall removes unedited template files and keeps edited ones", () => {
  const t = templates();
  const dir = tmp("saw-un-");
  init(dir, { templates: t });
  writeFileSync(join(dir, "b.md"), "my edit\n");
  expect(uninstall(dir, { templates: t, dryRun: true }).done).toEqual(["a.md"]);
  expect(existsSync(join(dir, "a.md"))).toBe(true);
  const r = uninstall(dir, { templates: t });
  expect(r).toEqual({ done: ["a.md"], kept: ["b.md"] });
  expect(existsSync(join(dir, "a.md"))).toBe(false);
  expect(readFileSync(join(dir, "b.md"), "utf8")).toBe("my edit\n");
});

test("upgrade updates files still as installed, adds new ones, keeps edited ones", () => {
  const t = templates();
  const dir = tmp("saw-up-");
  init(dir, { templates: t });
  writeFileSync(join(dir, "b.md"), "my edit\n");
  writeFileSync(join(t, "a.md"), "v2\n");
  writeFileSync(join(t, "b.md"), "b2\n");
  writeFileSync(join(t, "c.md"), "new\n");
  const r = upgrade(dir, { templates: t });
  expect(r).toEqual({ done: ["a.md", "c.md"], kept: ["b.md"] });
  expect(readFileSync(join(dir, "a.md"), "utf8")).toBe("v2\n");
  // Installed by the upgrade, so it now counts as unedited at v2.
  expect(uninstall(dir, { templates: t, dryRun: true }).done).toEqual(["a.md", "c.md"]);
});

test("dep_audit is picked from the lockfiles present", () => {
  const dir = tmp("saw-dep-");
  expect(depAuditFor(dir)).toBeUndefined();
  writeFileSync(join(dir, "bun.lock"), "");
  writeFileSync(join(dir, "composer.lock"), "");
  expect(depAuditFor(dir)).toBe("bun audit && composer audit");
});

test("init writes the detected dep_audit into a new workflow.toml", async () => {
  const { run } = await import("../src/main");
  const dir = tmp("saw-depcli-");
  writeFileSync(join(dir, "Cargo.lock"), "");
  expect(run(["init"], dir)).toBe(0);
  expect(readFileSync(join(dir, "workflow.toml"), "utf8")).toContain('dep_audit = "cargo audit"');
  // The append is recorded, so uninstall still sees workflow.toml as unedited.
  expect(uninstall(dir, { dryRun: true }).kept).not.toContain("workflow.toml");
  expect(upgrade(dir, { dryRun: true }).done).not.toContain("workflow.toml");
});

test("changed tests map by naming convention", () => {
  const tracked = ["src/foo.ts", "test/foo.test.ts", "tests/test_bar.py", "pkg/baz_test.go", "tests/QuxTest.php", "test/other.test.ts"];
  expect(changedTests(["src/foo.ts"], tracked)).toEqual(["test/foo.test.ts"]);
  expect(changedTests(["bar.py", "baz.go", "app/Qux.php"], tracked)).toEqual(["pkg/baz_test.go", "tests/QuxTest.php", "tests/test_bar.py"]);
  expect(changedTests(["test/other.test.ts"], tracked)).toEqual(["test/other.test.ts"]);
  expect(changedTests(["README.md"], tracked)).toEqual([]);
});

test("saw run --changed narrows the command and notes it", async () => {
  const { run } = await import("../src/main");
  const dir = tmp("saw-chg-");
  Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "test"));
  writeFileSync(join(dir, "src", "foo.ts"), "");
  writeFileSync(join(dir, "test", "foo.test.ts"), "");
  writeFileSync(join(dir, "workflow.toml"), '[checks]\ntest = "echo"\n');
  expect(run(["run", "test", "--changed"], dir)).toBe(0);
  expect(readFileSync(join(dir, ".saw", "logs", "test.log"), "utf8")).toContain("test/foo.test.ts");
  expect(readFileSync(join(dir, ".saw", "checks.jsonl"), "utf8")).toContain("changed files only");
});

test("the audit catalogue shows on its triggers only, and follows features.audit", () => {
  expect(taskSteps(config(), "critical", "integration").join(" ")).toContain("audit: appsec-review");
  expect(taskSteps(config(), "standard", "hardening").join(" ")).toContain("≤100000 tokens each");
  expect(taskSteps(config(), "standard", "feature").join(" ")).not.toContain("audit:");
  expect(taskSteps(config("[features]\naudit = false\n"), "critical", "audit").join(" ")).not.toContain("audit:");
});

const state = (over: Partial<State> = {}): State => ({
  repo: { allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: false, delete_branch_on_merge: true, allow_auto_merge: false, security_and_analysis: { secret_scanning: { status: "enabled" }, secret_scanning_push_protection: { status: "enabled" } } },
  labels: ["tier:trivial", "tier:standard", "tier:complex", "tier:critical"],
  protection: { required_pull_request_reviews: { required_approving_review_count: 1 }, allow_force_pushes: { enabled: false } },
  dependabot_alerts: true,
  dependabot_fixes: true,
  ...over,
});

test("repo plan diffs only what differs", () => {
  const c = config();
  const changes = repoPlan(c, "o/r", state());
  expect(changes.map((ch) => ch.what)).toEqual(["merge.merge_commit"]);
  expect(changes[0]!.args).toEqual(["api", "-X", "PATCH", "repos/o/r", "-F", "allow_merge_commit=false"]);
  const more = repoPlan(c, "o/r", state({ labels: [], protection: undefined, dependabot_alerts: false })).map((ch) => ch.what);
  expect(more).toContain("security.dependabot_alerts");
  expect(more).toContain("label tier:critical");
  expect(more.some((w) => w.startsWith("protect main"))).toBe(true);
});

test("repo apply reports plan-gated features as skipped", () => {
  const calls: string[][] = [];
  const fake: Gh = (args) => {
    calls.push(args);
    return args.includes("PUT") ? { code: 1, out: "HTTP 403: Upgrade to GitHub Pro" } : { code: 0, out: "" };
  };
  const changes = repoPlan(config(), "o/r", state({ protection: undefined }));
  const r = applyPlan(fake, changes);
  expect(r.applied).toContain("merge.merge_commit");
  expect(r.skipped[0]).toContain("(plan)");
  expect(r.failed).toEqual([]);
});

test("repo and report posting need explicit approval", async () => {
  const { repoCommand, run } = await import("../src/main");
  const args = { positional: [], flags: new Set<string>(), scope: "project" as const, overrides: {}, values: {} };
  expect(repoCommand(config(), "plan", args)).toBe(1);
  const fake: Gh = (a) => (a[0] === "repo" ? { code: 0, out: "o/r\n" } : a.includes("PATCH") ? { code: 0, out: "" } : { code: 0, out: JSON.stringify(state().repo) });
  const enabled = config("[repo]\nenabled = true\n");
  expect(repoCommand(enabled, "apply", args, fake)).toBe(1);
  const dir = tmp("saw-post-");
  writeFileSync(join(dir, "workflow.toml"), "");
  expect(run(["task", "start", "--tier", "trivial", "--playbook", "feature"], dir)).toBe(0);
  expect(run(["task", "report", "--post"], dir)).toBe(1);
  expect(run(["task", "report", "--post", "--yes", "--set", "autonomy.actions.open_pr=never"], dir)).toBe(1);
});

test("outline lists signatures with line numbers", () => {
  const dir = tmp("saw-out-");
  const ts = join(dir, "a.ts");
  writeFileSync(ts, "import x from 'y';\nexport const K = 1;\nexport function foo(a: string): number {\n  const r = 2;\n  if (a) {\n    return 1;\n  }\n}\nclass Bar {\n  baz(n: number): void {\n  }\n}\n");
  expect(outline(ts)).toEqual(["2: export const K = 1;", "3: export function foo(a: string): number", "9: class Bar", "10: baz(n: number): void"]);
  const py = join(dir, "b.py");
  writeFileSync(py, "def f():\n    pass\nclass C:\n    async def g(self):\n        pass\n");
  expect(outline(py)).toEqual(["1: def f():", "3: class C:", "4: async def g(self):"]);
  writeFileSync(join(dir, "c.xyz"), "");
  expect(() => outline(join(dir, "c.xyz"))).toThrow("no outline pattern");
});
