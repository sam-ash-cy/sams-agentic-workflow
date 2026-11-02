import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aboutHook, aboutSummary, parseAbout } from "../src/about-me";
import { resolve } from "../src/config";
import { DEFAULTS, type Table } from "../src/defaults";
import { catalog, figmaFallback, findSkills, installSteps, isInstalled, recommendHook } from "../src/recommend";

const none = { mcp: new Set<string>(), plugins: new Set<string>() };

function project(toml = ""): { dir: string; config: Table } {
  const dir = mkdtempSync(join(tmpdir(), "saw-rec-"));
  writeFileSync(join(dir, "workflow.toml"), toml);
  const missing = join(dir, "none.toml");
  return { dir, config: resolve(dir, {}, { global: missing, project: join(dir, "workflow.toml"), local: missing }).config };
}

const context = (o: Record<string, unknown> | undefined): string => (o?.hookSpecificOutput as { additionalContext: string } | undefined)?.additionalContext ?? "";

test("about_me, recommend and skill_finder are on by default, in auto mode", () => {
  const f = DEFAULTS.features as Record<string, boolean>;
  expect([f.about_me, f.recommend, f.skill_finder]).toEqual([true, true, true]);
  expect((DEFAULTS.recommend as Table).mode).toBe("auto");
});

test("the catalog has 10 MCP servers and 10 skills, each installed by a claude command", () => {
  const c = catalog();
  expect(c.filter((r) => r.kind === "mcp")).toHaveLength(10);
  expect(c.filter((r) => r.kind === "skills")).toHaveLength(10);
  expect(c.map((r) => r.id)).toContain("github");
  expect(c.map((r) => r.id)).toContain("figma");
  for (const r of c) expect(r.install[0]).toBe("claude");
});

test("a prompt that needs a missing server gets one suggestion per session", () => {
  const { dir, config } = project();
  const first = recommendHook(dir, config, { prompt: "Open a pull request on GitHub", session_id: "s1" }, none);
  expect(context(first)).toContain("saw recommend add github");
  expect(recommendHook(dir, config, { prompt: "and check the GitHub CI", session_id: "s1" }, none)).toBeUndefined();
  expect(context(recommendHook(dir, config, { prompt: "github again", session_id: "s2" }, none))).toContain("github");
  expect(recommendHook(dir, config, { prompt: "fix the typo", session_id: "s3" }, none)).toBeUndefined();
});

test("installed, disabled and manual-mode recommendations", () => {
  const { dir, config } = project();
  expect(recommendHook(dir, config, { prompt: "github pr", session_id: "a" }, { mcp: new Set(["github"]), plugins: new Set() })).toBeUndefined();
  expect(isInstalled(catalog().find((r) => r.id === "figma" && r.kind === "mcp")!, { mcp: new Set(["plugin:design:figma"]), plugins: new Set() })).toBe(true);
  const off = project("[features]\nrecommend = false\n");
  expect(recommendHook(off.dir, off.config, { prompt: "github pr", session_id: "a" }, none)).toBeUndefined();
  const manual = project('[recommend]\nmode = "manual"\nskills = false\n');
  const text = context(recommendHook(manual.dir, manual.config, { prompt: "build the landing page from figma", session_id: "a" }, none));
  expect(text).toContain("claude mcp add --transport http figma");
  expect(text).not.toContain("saw recommend add");
  expect(text).not.toContain("skill plugin");
});

test("the skill finder ranks skills by the task's changed files", () => {
  const { dir, config } = project();
  const found = findSkills(dir, config, "feature", ["src/App.tsx", "src/styles.css"], none);
  expect(found[0]!.id).toBe("frontend-design");
  expect(found.length).toBeLessThanOrEqual(3);
  expect(findSkills(dir, config, "debug", ["README"], none)).toEqual([]);
  const off = project("[recommend]\nskills = false\n");
  expect(findSkills(off.dir, off.config, "feature", ["a.tsx"], none)).toEqual([]);
});

test("install steps pass the scope on and add the marketplace first", () => {
  const gh = catalog().find((r) => r.id === "github")!;
  expect(installSteps(gh, "global")[0]!.slice(0, 5)).toEqual(["claude", "mcp", "add", "--scope", "user"]);
  expect(installSteps(gh)).toHaveLength(1);
  const docs = catalog().find((r) => r.id === "document-skills")!;
  expect(installSteps(docs)[0]).toEqual(["claude", "plugin", "marketplace", "add", "anthropics/skills"]);
});

test("a Figma limit error points the agent at the browser", () => {
  const { config } = project();
  expect(context(figmaFallback(config, { tool_name: "mcp__figma__get_design_context", error: "429 Too Many Requests" }))).toContain("browser");
  expect(figmaFallback(config, { tool_name: "mcp__figma__get_design_context", error: "file not found" })).toBeUndefined();
  expect(figmaFallback(config, { tool_name: "Bash", error: "rate limit" })).toBeUndefined();
});

test("about-me: answers merge per question, project over global", () => {
  const dir = mkdtempSync(join(tmpdir(), "saw-about-"));
  const paths = { global: join(dir, "g.md"), project: join(dir, "docs", "about-me.md"), local: join(dir, "l.md") };
  writeFileSync(paths.global, "# About me\n<!-- note -->\n## Goals\n### What are you building?\nA CLI\n### Deadline?\n\n## Communication\n### How long should replies be?\nShort\n");
  mkdirSync(join(dir, "docs"));
  writeFileSync(paths.project, "## Goals\n### What are you building?\nA plugin\n");
  expect(parseAbout("## G\n### Q?\n\n### R?\nyes\n").size).toBe(1);
  const s = aboutSummary(dir, paths)!;
  expect(s).toContain("What are you building? A plugin");
  expect(s).not.toContain("A CLI");
  expect(s).toContain("How long should replies be? Short");
  expect(s).not.toContain("Deadline");
  expect(aboutHook(dir, { about_me: false }, paths)).toBeUndefined();
  expect(aboutHook(mkdtempSync(join(tmpdir(), "saw-empty-")), { about_me: true }, { global: join(dir, "x"), project: join(dir, "y"), local: join(dir, "z") })).toBeUndefined();
});
