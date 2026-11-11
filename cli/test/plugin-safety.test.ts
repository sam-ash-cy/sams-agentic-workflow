import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { companionWarnings, readSyncedPluginNames, syncedPluginNames } from "../src/deps";
import { readOnlyGuard, unreadableSettingsGuard } from "../src/guard";

const root = join(import.meta.dir, "..", "..");
const decision = (out: Record<string, unknown> | undefined | null): string | undefined =>
  (out?.hookSpecificOutput as { permissionDecision?: string } | undefined)?.permissionDecision;

// An unsatisfied plugin.json dependency makes Claude Code skip saw entirely.
test("plugin.json declares no hard dependencies", () => {
  const manifest = JSON.parse(readFileSync(join(root, ".claude-plugin", "plugin.json"), "utf8"));
  expect(manifest.dependencies).toBeUndefined();
});

test("companion warnings name only the missing plugins whose features are on", () => {
  const features = { grilling: true, tdd: false, docs_step: true };
  const both = companionWarnings(JSON.stringify({ plugins: {} }), features);
  expect(both).toHaveLength(2);
  expect(both.join("\n")).toContain("claude plugin install engineering@sams-agentic-workflow");
  expect(companionWarnings(JSON.stringify({ plugins: { "engineering@x": [{}], "mattpocock-skills@x": [{}] } }), features)).toEqual([]);
  expect(companionWarnings(JSON.stringify({ plugins: {} }), { grilling: false, tdd: false, docs_step: false })).toEqual([]);
  expect(companionWarnings("{", features)).toEqual([]);
});

test("read-only tools skip the full guard but never reach the review key", () => {
  expect(readOnlyGuard({ tool_name: "Read", tool_input: { file_path: "README.md" } })).toBeUndefined();
  expect(decision(readOnlyGuard({ tool_name: "Read", tool_input: { file_path: "~/.saw/review-key" } }))).toBe("deny");
  expect(readOnlyGuard({ tool_name: "Bash", tool_input: { command: "ls" } })).toBeNull();
});

test("unreadable settings: changes ask, everything else goes through", () => {
  const problem = "settings unreadable (x)";
  for (const tool_name of ["Bash", "Edit", "Write", ""]) expect(decision(unreadableSettingsGuard({ tool_name, tool_input: {} }, problem))).toBe("ask");
  for (const tool_name of ["Read", "Grep", "Glob", "Agent", "Task"]) expect(unreadableSettingsGuard({ tool_name, tool_input: {} }, problem)).toBeUndefined();
  expect(decision(unreadableSettingsGuard({ tool_name: "Agent", tool_input: { prompt: "cat ~/.saw/review-key" } }, problem))).toBe("deny");
});

test("plugins the desktop app syncs count as installed companions", () => {
  const features = { grilling: true, tdd: true, docs_step: true };
  const empty = JSON.stringify({ plugins: {} });
  expect(companionWarnings(empty, features, ["engineering", "mattpocock-skills"])).toEqual([]);
  expect(companionWarnings(empty, features, ["engineering"])).toHaveLength(1);
  expect(syncedPluginNames(['{"name":"engineering"}', "not json", '{"x":1}'])).toEqual(["engineering"]);
});

test("readSyncedPluginNames reads synced/<group>/<id>/.claude-plugin/plugin.json", () => {
  const synced = join(mkdtempSync(join(tmpdir(), "saw-sync-")), "synced");
  const plugin = join(synced, "acct_org", "0eaf30dc", ".claude-plugin");
  mkdirSync(plugin, { recursive: true });
  writeFileSync(join(plugin, "plugin.json"), '{"name":"engineering"}');
  writeFileSync(join(synced, "acct_org", "manifest.json"), "{}");
  expect(readSyncedPluginNames(synced)).toEqual(["engineering"]);
  expect(readSyncedPluginNames(join(synced, "missing"))).toEqual([]);
});
