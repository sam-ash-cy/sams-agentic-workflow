import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compactSettings, syncCompact } from "../src/autocompact";
import { resolve } from "../src/config";

function config(toml = ""): ReturnType<typeof resolve>["config"] {
  const dir = mkdtempSync(join(tmpdir(), "saw-ac-"));
  writeFileSync(join(dir, "workflow.toml"), toml);
  const none = join(dir, "none.toml");
  return resolve(dir, {}, { global: none, project: none, local: join(dir, "workflow.toml") }).config;
}

test("defaults leave Claude Code's auto-compact alone", () => {
  expect(compactSettings(config())).toEqual({ set: {}, warnings: [] });
});

test("on/off and a window map to autoCompactEnabled/autoCompactWindow", () => {
  expect(compactSettings(config('[context]\nautocompact = "off"\n')).set).toEqual({ autoCompactEnabled: false });
  expect(compactSettings(config('[context]\nautocompact = "on"\nautocompact_window = 190000\n')).set).toEqual({ autoCompactEnabled: true, autoCompactWindow: 190000 });
});

test("warns on an out-of-range window or one below the handoff nudge", () => {
  expect(compactSettings(config("[context]\nautocompact_window = 50\n")).warnings[0]).toContain("outside");
  expect(compactSettings(config("[context]\nautocompact_window = 120000\n")).warnings[0]).toContain("before the handoff nudge");
});

test("syncCompact merges into the settings file and keeps other keys", () => {
  const root = mkdtempSync(join(tmpdir(), "saw-ac-"));
  const path = join(root, ".claude", "settings.local.json");
  const track = join(root, ".saw", "autocompact.json");
  const c = config('[context]\nautocompact = "off"\n');
  expect(syncCompact(path, track, c, true).changed).toBe(true);
  syncCompact(path, track, c);
  writeFileSync(path, JSON.stringify({ theme: "dark", ...JSON.parse(readFileSync(path, "utf8")) }));
  expect(syncCompact(path, track, c).changed).toBe(false);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ theme: "dark", autoCompactEnabled: false });
  writeFileSync(path, "{bad");
  expect(() => syncCompact(path, track, c)).toThrow("not valid JSON");
});

test("back to inherit removes only the value saw wrote", () => {
  const root = mkdtempSync(join(tmpdir(), "saw-ac-"));
  const path = join(root, ".claude", "settings.local.json");
  const track = join(root, ".saw", "autocompact.json");
  const off = config('[context]\nautocompact = "off"\n');
  syncCompact(path, track, off);
  expect(syncCompact(path, track, config()).removed).toEqual(["autoCompactEnabled"]);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({});
  // A value the user changed by hand stays.
  syncCompact(path, track, off);
  writeFileSync(path, JSON.stringify({ autoCompactEnabled: true }));
  expect(syncCompact(path, track, config()).removed).toEqual([]);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ autoCompactEnabled: true });
});
