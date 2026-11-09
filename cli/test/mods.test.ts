import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMods, listMods } from "../src/mods";

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "saw-mods-"));
  for (const [name, tests] of [["alpha", true], ["beta", false]] as const) {
    mkdirSync(join(root, "mods", name, ".claude-plugin"), { recursive: true });
    writeFileSync(join(root, "mods", name, ".claude-plugin", "plugin.json"), `{"name":"${name}"}`);
    if (tests) {
      mkdirSync(join(root, "mods", name, "tests"));
      writeFileSync(join(root, "mods", name, "tests", "a.test.ts"), "");
    }
  }
  mkdirSync(join(root, "mods", "not-a-mod"));
  return root;
}

test("listMods finds folders with a plugin manifest", () => {
  expect(listMods(fixture())).toEqual(["alpha", "beta"]);
});

test("checkMods validates every mod and tests only those with tests", () => {
  const calls: string[] = [];
  const results = checkMods(fixture(), (cmd) => (calls.push(cmd.slice(0, 3).join(" ")), cmd[2] === "test" ? 1 : 0));
  expect(results).toEqual([
    { name: "alpha", validate: 0, test: 1 },
    { name: "beta", validate: 0, test: null },
  ]);
  expect(calls.filter((c) => c === "claude plugin test")).toHaveLength(1);
});

test("checkMods can check one mod", () => {
  expect(checkMods(fixture(), () => 0, "beta").map((r) => r.name)).toEqual(["beta"]);
});
