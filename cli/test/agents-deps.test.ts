import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modelFor, syncAgents } from "../src/agents";
import { resolve } from "../src/config";
import { pin, readLock, verifyLock, type Dep } from "../src/deps";

const ROOT = join(import.meta.dir, "..", "..");
const none = (dir: string) => ({ global: join(dir, "x.toml"), project: join(dir, "x.toml"), local: join(dir, "x.toml") });
const defaults = resolve(ROOT, {}, none(mkdtempSync(join(tmpdir(), "saw-")))).config;

test("roles map through cheap/mid/strong, or inherit in single mode", () => {
  expect(modelFor(defaults, "research")).toBe("haiku");
  expect(modelFor(defaults, "review")).toBe("sonnet");
  expect(modelFor(defaults, "security_review")).toBe("opus");
  const single = resolve(ROOT, { "models.mode": "single" }, none(mkdtempSync(join(tmpdir(), "saw-")))).config;
  expect(modelFor(single, "research")).toBe("inherit");
});

test("committed agents match the default routing, and sync only touches model lines", () => {
  const dir = mkdtempSync(join(tmpdir(), "saw-plugin-"));
  cpSync(join(ROOT, "agents"), join(dir, "agents"), { recursive: true });
  expect(syncAgents(dir, defaults).filter((a) => a.changed)).toEqual([]);

  const before = readFileSync(join(dir, "agents", "researcher.md"), "utf8");
  const cheapSonnet = resolve(ROOT, { "models.cheap": "sonnet" }, none(dir)).config;
  expect(syncAgents(dir, cheapSonnet, true).find((a) => a.name === "researcher")?.changed).toBe(true);
  expect(readFileSync(join(dir, "agents", "researcher.md"), "utf8")).toBe(before); // dry run
  syncAgents(dir, cheapSonnet);
  const after = readFileSync(join(dir, "agents", "researcher.md"), "utf8");
  expect(after).toBe(before.replace("model: haiku", "model: sonnet"));
  expect(syncAgents(dir, cheapSonnet).filter((a) => a.changed)).toEqual([]); // idempotent
});

test("deps verify catches bad pins; pending reviews are reported separately", () => {
  const good: Dep = { repo: "https://github.com/a/b", sha: "a".repeat(40), licence: "MIT", reviewed_by: "sam", reviewed_on: "2026-10-31" };
  const allowed = ["MIT"];
  expect(verifyLock({ good }, allowed)).toEqual({ errors: [], pending: [] });
  const bad = verifyLock({ x: { ...good, sha: "main", licence: "GPL-3.0", reviewed_by: "" } }, allowed);
  expect(bad.errors.length).toBe(3);
  expect(verifyLock({ y: { ...good, reviewed_by: "pending" } }, allowed).pending.length).toBe(1);
});

test("the committed lock is valid", () => {
  const v = verifyLock(readLock(join(ROOT, "deps.lock.toml")), defaults.deps!.allowed_licences as string[]);
  expect(v.errors).toEqual([]);
});

test("pin writes the new sha and reviewer, and refuses without a reviewer", () => {
  const dir = mkdtempSync(join(tmpdir(), "saw-lock-"));
  const path = join(dir, "deps.lock.toml");
  cpSync(join(ROOT, "deps.lock.toml"), path);
  expect(() => pin(path, "rederive", "b".repeat(40), "")).toThrow("--reviewed-by");
  pin(path, "rederive", "b".repeat(40), "sam", "2026-11-01");
  expect(readLock(path).rederive).toMatchObject({ sha: "b".repeat(40), reviewed_by: "sam", reviewed_on: "2026-11-01", licence: "MIT" });
  expect(readLock(path)["mattpocock-skills"]?.reviewed_by).toBe("pending");
});

test("sync keeps CRLF line endings", () => {
  const dir = mkdtempSync(join(tmpdir(), "saw-crlf-"));
  cpSync(join(ROOT, "agents"), join(dir, "agents"), { recursive: true });
  const path = join(dir, "agents", "researcher.md");
  writeFileSync(path, readFileSync(path, "utf8").replace(/\r?\n/g, "\r\n"));
  syncAgents(dir, resolve(ROOT, { "models.cheap": "sonnet" }, none(dir)).config);
  expect(readFileSync(path, "utf8")).toContain("model: sonnet\r\n");
});
