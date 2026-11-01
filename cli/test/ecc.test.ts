import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nudgeFor } from "../src/context";
import { DEFAULTS, type Table } from "../src/defaults";
import { eccProblem, readLock } from "../src/deps";
import { taskSteps } from "../src/task";

const root = join(import.meta.dir, "..", "..");
const config = (ecc: boolean): Table => ({ ...DEFAULTS, features: { ...(DEFAULTS.features as Table), ecc } });
const installed = (sha: string) => JSON.stringify({ version: 2, plugins: { "ecc@sams-agentic-workflow": [{ gitCommitSha: sha }] } });

test("features.ecc is off by default and pinned in both the lock and the marketplace", () => {
  expect((DEFAULTS.features as Record<string, boolean>).ecc).toBe(false);
  const lock = readLock(join(root, "deps.lock.toml")).ecc;
  expect(lock).toMatchObject({ repo: "https://github.com/affaan-m/ECC", licence: "MIT" });
  const market = JSON.parse(readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8"));
  expect(market.plugins.find((p: { name: string }) => p.name === "ecc").source.sha).toBe(lock!.sha);
});

test("the compact nudge hands off to ecc:strategic-compact only when features.ecc is on", () => {
  expect(nudgeFor(config(true), 110000, [])?.message).toContain("ecc:strategic-compact");
  expect(nudgeFor(config(false), 110000, [])?.message).not.toContain("ecc:");
});

test("features.ecc adds a verification-loop step to delivering playbooks only", () => {
  expect(taskSteps(config(true), "standard", "feature").join(" ")).toContain("ecc:verification-loop");
  expect(taskSteps(config(true), "standard", "debug").join(" ")).not.toContain("ecc:");
  expect(taskSteps(config(false), "standard", "feature").join(" ")).not.toContain("ecc:");
});

test("doctor's ecc check: missing, unparseable, off-pin and pinned installs", () => {
  const sha = "b38be6a7f6350964d59328b52f0624e1d1d552d1";
  expect(eccProblem(undefined, sha)).toContain("isn't installed");
  expect(eccProblem(JSON.stringify({ plugins: { "other@x": [{}] } }), sha)).toContain("isn't installed");
  expect(eccProblem("{", sha)).toContain("isn't valid JSON");
  expect(eccProblem(installed("0".repeat(40)), sha)).toContain("not the pinned");
  expect(eccProblem(installed(sha), sha)).toBeUndefined();
  expect(eccProblem(JSON.stringify({ plugins: { "ecc@ecc": [{ gitCommitSha: sha }] } }), sha)).toBeUndefined();
});
