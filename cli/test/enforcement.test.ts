import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENFORCED_MODES, flatten, resolve } from "../src/config";

function layers(global = "", project = "", local = "") {
  const dir = mkdtempSync(join(tmpdir(), "saw-enforcement-"));
  const paths = { global: join(dir, "global.toml"), project: join(dir, "workflow.toml"), local: join(dir, "workflow.local.toml") };
  writeFileSync(paths.global, global);
  writeFileSync(paths.project, project);
  writeFileSync(paths.local, local);
  return resolve(dir, {}, paths);
}

test("enforcement = custom leaves each mode to its own key", () => {
  const r = layers('[tokens]\nmode = "hard"\n[style]\nmode = "soft"');
  const flat = flatten(r.config);
  expect(flat.enforcement).toBe("custom");
  expect(flat["tokens.mode"]).toBe("hard");
  expect(r.sources["tokens.mode"]).toBe("global");
});

test("enforcement = strict forces the six modes hard, and says the preset set them", () => {
  const r = layers('enforcement = "strict"\n[tokens]\nmode = "soft"');
  const flat = flatten(r.config);
  for (const key of ENFORCED_MODES) {
    expect(flat[key]).toBe("hard");
    expect(r.sources[key]).toBe("enforcement=strict");
  }
});

test("enforcement = relaxed forces the six modes soft from your own layers", () => {
  const r = layers("", "", 'enforcement = "relaxed"\n[verify]\nmode = "hard"');
  const flat = flatten(r.config);
  for (const key of ENFORCED_MODES) {
    expect(flat[key]).toBe("soft");
    expect(r.sources[key]).toBe("enforcement=relaxed");
  }
});

test("a committed workflow.toml can go strict but not relaxed", () => {
  const strict = layers("", 'enforcement = "strict"');
  expect(flatten(strict.config).enforcement).toBe("strict");
  const relaxed = layers("", 'enforcement = "relaxed"');
  expect(flatten(relaxed.config).enforcement).toBe("custom");
  expect(relaxed.warnings.join("\n")).toContain("tries to weaken enforcement");
  // Nor can it undo a strict preset you set globally.
  const undo = layers('enforcement = "strict"', 'enforcement = "custom"');
  expect(flatten(undo.config).enforcement).toBe("strict");
});

test("an unknown preset is ignored with a warning", () => {
  const r = layers('enforcement = "maximum"');
  expect(flatten(r.config).enforcement).toBe("custom");
  expect(r.warnings.join("\n")).toContain("enforcement");
});

test("a one-off --set still beats the preset", () => {
  const dir = mkdtempSync(join(tmpdir(), "saw-enforcement-"));
  const paths = { global: join(dir, "g.toml"), project: join(dir, "workflow.toml"), local: join(dir, "l.toml") };
  writeFileSync(paths.global, 'enforcement = "strict"');
  const r = resolve(dir, { "tdd.mode": "soft" }, paths);
  expect(flatten(r.config)["tdd.mode"]).toBe("soft");
  expect(r.sources["tdd.mode"]).toBe("override");
  expect(flatten(r.config)["verify.mode"]).toBe("hard");
});
