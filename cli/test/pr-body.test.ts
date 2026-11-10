import { expect, test } from "bun:test";
import { prBody } from "../src/pr-body";

const c = (subject: string, body = "") => ({ hash: subject, subject, body });

test("pr body lists the branch's commits oldest first, then the verification section", () => {
  // git log gives newest first.
  const body = prBody([c("fix: second"), c("feat: first", "why it matters")], "**Verification: Verified** (standard / feature)");
  expect(body).toBe([
    "## Summary",
    "",
    "- feat: first",
    "- fix: second",
    "",
    "## Checks",
    "",
    "**Verification: Verified** (standard / feature)",
  ].join("\n"));
});

test("merge commits and fixups are left out of the summary", () => {
  const body = prBody([c("Merge branch 'main' into feat/x"), c("fixup! feat: a"), c("feat: a")], "r");
  expect(body).toContain("- feat: a");
  expect(body).not.toContain("Merge branch");
  expect(body).not.toContain("fixup!");
});

test("with no commits the summary says so", () => {
  expect(prBody([], "r")).toContain("No commits on this branch yet");
});

test("saw task pr-body prints the summary and the verification section", () => {
  const { mkdtempSync, writeFileSync } = require("node:fs");
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const dir: string = mkdtempSync(join(tmpdir(), "saw-prb-"));
  const git = (...a: string[]) => Bun.spawnSync(["git", ...a], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  git("init", "-q", "-b", "main");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "chore: base");
  git("switch", "-q", "-c", "feat/x");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "feat: the thing");
  writeFileSync(join(dir, "workflow.toml"), "");
  const saw = (...a: string[]) => Bun.spawnSync(["bun", join(import.meta.dir, "../src/main.ts"), ...a], { cwd: dir, stdout: "pipe", stderr: "pipe", env: { ...process.env, SAW_HOME: join(dir, ".saw-home"), SAW_NO_PLUGIN: "1" } });
  expect(saw("task", "start", "--tier", "standard", "--playbook", "feature").exitCode).toBe(0);
  const out = saw("task", "pr-body", "--base", "main");
  expect(out.exitCode).toBe(0);
  const text = out.stdout.toString();
  expect(text).toContain("- feat: the thing");
  expect(text).not.toContain("chore: base");
  expect(text).toContain("**Verification:");
});
