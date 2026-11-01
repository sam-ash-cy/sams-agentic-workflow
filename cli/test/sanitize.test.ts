import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { sanitize, scanText } from "../src/sanitize";
import { run } from "../src/main";

// Fixtures are built from pieces so this file doesn't trip the scan itself.
const home = ["C:", "Users", "jdoe", "repo"].join("\\");
const key = "AKIA" + "ABCDEFGHIJKLMNOP";
const mail = "jdoe" + "@" + "mail.test";

test("finds secrets, home paths, emails and names, by kind", () => {
  const text = [`path ${home}`, `key ${key}`, `mail ${mail}`, "by Jane-Doe here", "/home" + "/jdoe/x"].join("\n");
  const kinds = scanText("f.md", text, ["jane-doe"]).map((f) => `${f.line}:${f.kind}`);
  expect(kinds).toEqual(["1:path", "2:secret", "3:email", "4:name", "5:path"]);
});

test("a secret finding names the kind, never the value", () => {
  const [f] = scanText("f", `token ${key}`, []);
  expect(f.match).toBe("AWS access key");
});

test("placeholders, safe emails, file names and allowed literals don't match", () => {
  const text = [
    "C:\\Users\\<you>\\.claude",
    "/home/runner/work",
    "$HOME/Users/x",
    "noreply" + "@anthropic.com",
    "a" + "@example.com",
    "@saw-workflow.md",
    `${home} saw-sanitize: allow`,
    "owner jane-doe/repo",
  ].join("\n");
  expect(scanText("f", text, ["jane-doe"], ["jane-doe/repo"])).toEqual([]);
});

test("a name inside a longer word isn't a match", () => {
  expect(scanText("f", "the session ran", ["sess"])).toEqual([]);
});

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "saw-sanitize-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "Jane Q Tester"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "jqt" + "@corp.test"], { cwd: dir });
  return dir;
}

test("scans published files only, and the git identity counts as a name", () => {
  const dir = repo();
  writeFileSync(join(dir, ".gitignore"), "secret.txt\n");
  writeFileSync(join(dir, "secret.txt"), key);
  writeFileSync(join(dir, "notes.md"), "written by Jane Q Tester\n");
  writeFileSync(join(dir, "bin.dat"), Buffer.from([0, 1, 2]));
  writeFileSync(join(dir, "wide.txt"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`at ${home}`, "utf16le")]));
  const none = join(dir, "none.toml");
  const { config } = resolve(dir, {}, { global: none, project: join(dir, "workflow.toml"), local: none });
  expect(sanitize(dir, config).map((f) => `${f.file}:${f.kind}`)).toEqual(["notes.md:name", "wide.txt:path"]);
});

test("saw sanitize exits 1 on findings and refuses names from workflow.toml", () => {
  const dir = repo();
  writeFileSync(join(dir, "a.md"), `see ${home}\n`);
  expect(run(["sanitize"], dir)).toBe(1);
  writeFileSync(join(dir, "a.md"), "clean\n");
  expect(run(["sanitize"], dir)).toBe(0);
  writeFileSync(join(dir, "workflow.toml"), '[release]\nnames = ["x"]\n');
  expect(run(["sanitize"], dir)).toBe(1);
});
