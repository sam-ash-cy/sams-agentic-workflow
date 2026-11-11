import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSetting } from "../src/config";

const tmp = (): string => join(mkdtempSync(join(tmpdir(), "saw-ws-")), "workflow.toml");

describe("writeSetting", () => {
  test("a valid write keeps comments", () => {
    const path = tmp();
    writeFileSync(path, '# keep me\n[tokens]\nmode = "soft" # inline\n');
    const r = writeSetting(path, "local", "tokens.mode", "hard");
    expect(r.ok).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("# keep me");
    expect(text).toContain('"hard"');
  });

  test("creates the file and its folder when missing", () => {
    const path = join(mkdtempSync(join(tmpdir(), "saw-ws-")), "sub", "config.toml");
    expect(writeSetting(path, "global", "features.trail", true).ok).toBe(true);
    expect(readFileSync(path, "utf8")).toContain("trail");
  });

  test("an invalid value is rejected and nothing is written", () => {
    const path = tmp();
    writeFileSync(path, "[tokens]\n");
    const r = writeSetting(path, "local", "tokens.mode", "nonsense");
    expect(r.ok).toBe(false);
    expect(r.problem).toBeTruthy();
    expect(readFileSync(path, "utf8")).toBe("[tokens]\n");
  });

  test("an unknown key is rejected", () => {
    expect(writeSetting(tmp(), "local", "nope.nothing", true).ok).toBe(false);
  });

  test("unset of a missing key reports it", () => {
    const path = tmp();
    writeFileSync(path, "");
    const r = writeSetting(path, "local", "tokens.mode", undefined);
    expect(r.ok).toBe(false);
    expect(r.problem).toContain("not set");
  });

  test("unset removes a present key", () => {
    const path = tmp();
    writeFileSync(path, '[tokens]\nmode = "hard"\n');
    expect(writeSetting(path, "local", "tokens.mode", undefined).ok).toBe(true);
    expect(readFileSync(path, "utf8")).not.toContain("hard");
  });

  test("weakening a guarded key in the project layer warns but writes", () => {
    const path = tmp();
    const r = writeSetting(path, "project", "safety.push", "allow");
    expect(r.ok).toBe(true);
    expect(r.warning).toContain("tighten");
  });
});
