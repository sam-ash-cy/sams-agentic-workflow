import { expect, test } from "bun:test";
import { join } from "node:path";
import { fastReadAllowed } from "../src/read-fast";

const p = (tool_name: string, tool_input: unknown): string => JSON.stringify({ tool_name, tool_input });
const KEY = join("~", ".saw", ["review", "key"].join("-"));

test("plain Read, Grep and Glob calls take the fast path", () => {
  expect(fastReadAllowed(p("Read", { file_path: "src/a.ts" }))).toBe(true);
  expect(fastReadAllowed(p("Grep", { pattern: "foo", path: "cli" }))).toBe(true);
  expect(fastReadAllowed(p("Glob", { pattern: "**/*.ts" }))).toBe(true);
});

test("secrets, the signing key, .saw paths and other tools take the full guard", () => {
  expect(fastReadAllowed(p("Read", { file_path: ".env" }))).toBe(false);
  expect(fastReadAllowed(p("Read", { file_path: "app/.env.local" }))).toBe(false);
  expect(fastReadAllowed(p("Read", { file_path: KEY }))).toBe(false);
  expect(fastReadAllowed(p("Glob", { pattern: join(".saw", "x") }))).toBe(false);
  expect(fastReadAllowed(p("Bash", { command: "ls" }))).toBe(false);
  expect(fastReadAllowed(p("Edit", { file_path: "a.ts" }))).toBe(false);
  expect(fastReadAllowed("not json")).toBe(false);
  expect(fastReadAllowed(p("Read", null))).toBe(false);
});

test("the guard hook entry still denies the signing key and exits quietly for a plain read", () => {
  const entry = join(import.meta.dir, "..", "..", "hooks", "run", "guard.ts");
  const run = (payload: string): string => Bun.spawnSync(["bun", entry], { stdin: Buffer.from(payload), stdout: "pipe", stderr: "pipe", timeout: 20000 }).stdout.toString();
  expect(run(p("Read", { file_path: KEY }))).toContain("deny");
  expect(run(p("Read", { file_path: "README.md" }))).toBe("");
});
