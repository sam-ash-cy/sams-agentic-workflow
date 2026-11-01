import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkAdapters, installAdapters } from "../src/adapters";
import { syncVault, vaultPath } from "../src/vault";

const tmp = (p: string): string => mkdtempSync(join(tmpdir(), p));

test("adapters are added without overwriting, and the smoke test finds what's missing", () => {
  const dir = tmp("saw-agents-");
  expect(checkAdapters(dir, ["claude"])).toEqual(["AGENTS.md is missing (saw init adds it)"]);
  writeFileSync(join(dir, "AGENTS.md"), "# rules\n");
  writeFileSync(join(dir, "CLAUDE.md"), "notes\n");
  expect(checkAdapters(dir, ["claude", "codex", "cursor", "gemini", "vim"])).toEqual([
    "claude: CLAUDE.md doesn't import @AGENTS.md",
    'gemini: add "AGENTS.md" to contextFileName in .gemini/settings.json (saw init --agents gemini)',
    "vim: unknown agent (one of claude, codex, cursor, gemini)",
  ]);

  writeFileSync(join(dir, "CLAUDE.md"), "@AGENTS.md\n");
  expect(installAdapters(dir, ["cursor", "gemini"]).installed).toEqual([".cursor/rules/saw.mdc", ".gemini/settings.json"]);
  expect(checkAdapters(dir, ["claude", "codex", "cursor", "gemini"])).toEqual([]);
  expect(installAdapters(dir, ["gemini"]).skipped[0]).toContain("exists");

  writeFileSync(join(dir, ".gemini", "settings.json"), "{broken");
  expect(checkAdapters(dir, ["gemini"])).toEqual(["gemini: .gemini/settings.json is not valid JSON"]);
});

test("vault_path must be absolute, existing and personal", () => {
  const vault = tmp("saw-vault-");
  expect(vaultPath("", "global").error).toContain("not set");
  expect(vaultPath(vault, "project").error).toContain("personal path");
  expect(vaultPath("rel/vault", "local").error).toContain("absolute");
  expect(vaultPath(join(vault, "nope"), "global").error).toContain("not found");
  expect(vaultPath(vault, "global").path).toBe(vault);
});

test("vault sync writes the project note and copies learnings by store", () => {
  const vault = tmp("saw-vault-");
  const project = join(tmp("saw-proj-"), "My App");
  mkdirSync(join(project, "docs", "learnings"), { recursive: true });
  mkdirSync(join(project, "docs", "decisions"), { recursive: true });
  writeFileSync(join(project, "docs", "learnings", "cache.md"), "# cache\n");
  writeFileSync(join(project, "docs", "learnings", "README.md"), "index\n");
  writeFileSync(join(project, "docs", "decisions", "0001-x.md"), "# x\n");

  const repoOnly = syncVault(vault, project, "repo", [], false, "2026-11-01");
  expect(repoOnly.copied).toEqual([]);
  const note = readFileSync(join(vault, "projects", "my-app.md"), "utf8");
  expect(note).toContain("- 0001-x");
  expect(note).toContain("- cache\n"); // not copied with store = repo, so no wikilink

  expect(syncVault(vault, project, "vault", [], true).copied).toEqual(["cache.md"]);
  expect(existsSync(join(vault, "learnings", "my-app", "cache.md"))).toBe(false); // dry run
  syncVault(vault, project, "vault", []);
  writeFileSync(join(vault, "learnings", "my-app", "cache.md"), "edited in vault\n");
  const both = syncVault(vault, project, "both", []);
  expect(both.warnings.length).toBe(2);
  expect(readFileSync(join(vault, "learnings", "my-app", "cache.md"), "utf8")).toBe("# cache\n");
  expect(readFileSync(join(vault, "projects", "my-app.md"), "utf8")).toContain("[[learnings/my-app/cache]]");

  const twin = join(tmp("saw-proj-"), "My App"); // same folder name, different project
  mkdirSync(twin);
  expect(syncVault(vault, twin, "repo", []).warnings[0]).toContain("belongs to");
  expect(readFileSync(join(vault, "projects", "my-app.md"), "utf8")).toContain(project.replaceAll("\\", "/"));
});

test("CLI: init --agents and agents check", async () => {
  const { run } = await import("../src/main");
  const dir = tmp("saw-cli8-");
  expect(run(["init", "--agents", "gemni"], dir)).toBe(1);
  expect(run(["init", "--agents", "cursor,gemini"], dir)).toBe(0);
  writeFileSync(join(dir, "workflow.local.toml"), '[agents]\nenabled = ["claude", "codex", "cursor", "gemini"]\n');
  expect(run(["agents", "check"], dir)).toBe(0);
  const toml = readFileSync(join(dir, "workflow.toml"), "utf8").replace(/^\[knowledge\]$/m, `[knowledge]\nvault_path = "${tmpdir().replaceAll("\\", "/")}"`);
  writeFileSync(join(dir, "workflow.toml"), toml);
  expect(run(["vault", "sync"], dir)).toBe(1); // a committed workflow.toml can't point outside the repo
});
