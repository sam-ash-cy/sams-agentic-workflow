import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flatten, resolve, weakenedSafety, type LayerPaths } from "../src/config";
import { init } from "../src/init";
import { parseToml, stringifyToml } from "../src/toml";

function setup(files: Partial<Record<keyof LayerPaths, string>>): { dir: string; paths: LayerPaths } {
  const dir = mkdtempSync(join(tmpdir(), "saw-"));
  const paths: LayerPaths = {
    global: join(dir, "global.toml"),
    project: join(dir, "workflow.toml"),
    local: join(dir, "workflow.local.toml"),
  };
  for (const [layer, text] of Object.entries(files)) writeFileSync(paths[layer as keyof LayerPaths], text);
  return { dir, paths };
}

describe("resolve", () => {
  test("later layers win and sources are tracked", () => {
    const { dir, paths } = setup({
      global: '[autonomy]\nlevel = "suggest"\n[tokens]\nmode = "hard"',
      project: '[autonomy]\nlevel = "act"',
      local: '[autonomy]\nlevel = "propose"',
    });
    const r = resolve(dir, { "features.trail": true }, paths);
    const flat = flatten(r.config);
    expect(flat["autonomy.level"]).toBe("propose");
    expect(r.sources["autonomy.level"]).toBe("local");
    expect(r.sources["tokens.mode"]).toBe("global");
    expect(r.sources["features.trail"]).toBe("override");
    expect(r.sources["models.cheap"]).toBe("default");
  });

  test("project cannot weaken safety, global and local can", () => {
    const { dir, paths } = setup({ project: '[safety]\npush = "allow"\ndestructive_approval = false\ndeny = ["sudo"]' });
    const r = resolve(dir, {}, paths);
    const flat = flatten(r.config);
    expect(flat["safety.push"]).toBe("never");
    expect(flat["safety.destructive_approval"]).toBe(true);
    expect(flat["safety.deny"]).toContain("rm -rf");
    expect(flat["safety.deny"]).toContain("sudo");
    expect(r.warnings.length).toBe(2);

    const local = setup({ local: '[safety]\npush = "ask"' });
    const rl = resolve(local.dir, {}, local.paths);
    expect(flatten(rl.config)["safety.push"]).toBe("ask");
    expect(weakenedSafety(rl)).toEqual(['safety.push = "ask" (from local)']);
  });

  test("unknown keys, bad enums and wrong types are ignored with warnings", () => {
    const { dir, paths } = setup({ project: '[features]\nnope = true\n[autonomy]\nlevel = "yolo"\n[tokens]\nwarn_at = "high"' });
    const r = resolve(dir, {}, paths);
    expect(r.warnings.length).toBe(3);
    expect(flatten(r.config)["autonomy.level"]).toBe("propose");
  });
});

test("toml round-trips", () => {
  const table = { a: { b: "x", c: [1, 2], d: { e: true } }, f: 0.8 };
  expect(parseToml(stringifyToml(table))).toEqual(table);
});

describe("init", () => {
  test("dry run writes nothing", () => {
    const { dir } = setup({});
    const report = init(dir, { dryRun: true });
    expect(report.installed).toContain("workflow.toml");
    expect(existsSync(join(dir, "workflow.toml"))).toBe(false);
    expect(existsSync(join(dir, ".gitignore"))).toBe(false);
  });

  test("is idempotent and never overwrites without --force", () => {
    const { dir } = setup({});
    init(dir);
    const second = init(dir);
    expect(second.installed).toEqual([]);
    expect(second.changed).toEqual([]);

    writeFileSync(join(dir, "workflow.toml"), "# mine\n");
    expect(init(dir).skipped.some((s) => s.startsWith("workflow.toml (exists"))).toBe(true);
    expect(readFileSync(join(dir, "workflow.toml"), "utf8")).toBe("# mine\n");

    const forced = init(dir, { force: true });
    expect(forced.backedUp).toEqual(["workflow.toml -> workflow.toml.bak"]);
    expect(readFileSync(join(dir, "workflow.toml.bak"), "utf8")).toBe("# mine\n");
  });
});

test("committed schema matches the defaults", async () => {
  const { workflowSchema } = await import("../src/schema");
  const committed = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "schema", "workflow.schema.json"), "utf8"));
  expect(committed).toEqual(workflowSchema());
});

describe("project template", () => {
  test("context files pass the lint, and --type is applied by init", async () => {
    const { lintContext } = await import("../src/lint");
    const { TEMPLATE_DIR } = await import("../src/init");
    const { dir, paths } = setup({});
    expect(lintContext(TEMPLATE_DIR, resolve(dir, {}, paths).config)).toEqual([]);

    const { run } = await import("../src/main");
    writeFileSync(join(dir, "CLAUDE.md"), "# mine\n");
    expect(run(["init", "--type", "api"], dir)).toBe(0);
    expect(readFileSync(join(dir, "workflow.toml"), "utf8")).toContain('type = "api"');
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe("# mine\n");
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(true);
    expect(run(["init", "--type", "nope"], dir)).toBe(1);
  });
});

test("a leftover features.ecc in a user's TOML is ignored with a warning, not an error", () => {
  const { dir, paths } = setup({ project: "[features]\necc = true\n" });
  const r = resolve(dir, {}, paths);
  expect(r.warnings.join(" ")).toContain("features.ecc");
  expect(r.warnings.join(" ")).toContain("ignored");
  expect(flatten(r.config)["features.ecc"]).toBeUndefined();
});
