import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { docsStatus, staleReference } from "../src/docs";
import { init } from "../src/init";
import { taskSteps } from "../src/task";

test("docs status: blank after init, filled once edited, code detected", () => {
  const dir = mkdtempSync(join(tmpdir(), "saw-docs-"));
  init(dir);
  const before = docsStatus(dir, undefined, ["docs/index.md", "workflow.toml"]);
  expect(before.hasCode).toBe(false);
  expect(before.docs.find((d) => d.path === "docs/glossary.md")?.state).toBe("blank");
  expect(before.docs.some((d) => d.path.endsWith("_template.md"))).toBe(false);

  writeFileSync(join(dir, "docs", "glossary.md"), "# glossary\n\n- **saw**: the CLI\n");
  const after = docsStatus(dir, undefined, ["src/app.ts"]);
  expect(after.hasCode).toBe(true);
  expect(after.docs.find((d) => d.path === "docs/glossary.md")?.state).toBe("filled");
});

test("stale reference: surface changes without a docs/reference change", () => {
  expect(staleReference(["cli/src/main.ts", "README.md"])).toEqual(["cli/src/main.ts"]);
  expect(staleReference(["cli/src/main.ts", "docs/reference/cli.md"])).toEqual([]);
  expect(staleReference(["src/util.ts"])).toEqual([]);
});

test("living_docs adds a docs step to debug tasks only when on", () => {
  const dir = mkdtempSync(join(tmpdir(), "saw-docs-"));
  const cfg = (toml: string) => {
    writeFileSync(join(dir, "workflow.toml"), toml);
    return resolve(dir, {}, { global: join(dir, "none.toml"), project: join(dir, "workflow.toml"), local: join(dir, "none.toml") }).config;
  };
  expect(taskSteps(cfg(""), "standard", "debug").some((s) => s.includes("docs/reference/"))).toBe(true);
  expect(taskSteps(cfg("[features]\nliving_docs = false"), "standard", "debug").some((s) => s.includes("docs/reference/"))).toBe(false);
});

test("changed files: an option-looking base branch never reaches git", () => {
  const { changedFiles } = require("../src/docs");
  const dir = mkdtempSync(join(tmpdir(), "saw-docs-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
  expect(changedFiles(dir, "--output=pwned")).toEqual([]);
  expect(require("node:fs").existsSync(join(dir, "pwned"))).toBe(false);
});
