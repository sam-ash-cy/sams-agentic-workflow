// Bugs B7–B13 from the real-project run (docs/plans/config-matrix-report.md).

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { guardCommand } from "../src/guard";
import { guessType } from "../src/init";
import { runCheck } from "../src/run";
import { parseToml } from "../src/toml";

const MAIN = join(import.meta.dir, "..", "src", "main.ts");
const tmp = (p: string): string => mkdtempSync(join(tmpdir(), p));
const RMRF = ["rm", "-rf"].join(" ");

function project(toml = "", local = ""): { dir: string; env: Record<string, string> } {
  const dir = tmp("saw-rp-");
  writeFileSync(join(dir, "workflow.toml"), `[logging]\nlevel = "debug"\n${toml}`);
  if (local) writeFileSync(join(dir, "workflow.local.toml"), local);
  const home = tmp("saw-rp-home-");
  return { dir, env: { ...process.env, SAW_HOME: home, HOME: home, USERPROFILE: home } as Record<string, string> };
}

function hook(p: { dir: string; env: Record<string, string> }, name: string, payload: unknown): void {
  Bun.spawnSync(["bun", MAIN, name], { cwd: p.dir, env: p.env, stdin: Buffer.from(JSON.stringify(payload)), stdout: "pipe", stderr: "pipe" });
}

const events = (dir: string): string => {
  try {
    return readFileSync(join(dir, ".saw", "events.jsonl"), "utf8");
  } catch {
    return "";
  }
};

test("B7: an unclosed table header is a parse error", () => {
  expect(() => parseToml('[project]\ntype = "api"\n\n[broken\n')).toThrow(/bad table header/);
  const ok = parseToml('[a]\nx = [\n  [1, 2],\n  [3],\n]\n[[b]]\ny = """\n[not a header\n"""\n');
  expect(ok.a).toEqual({ x: [[1, 2], [3]] });
  expect(JSON.stringify(ok.b)).toContain("[not a header");
});

test("B8: checks use sh syntax on every platform", () => {
  const p = project('[checks]\ntest = "X=ok sh -c \'test $X = ok\'"\n');
  const c = resolve(p.dir, {}, { global: join(p.dir, "none.toml"), project: join(p.dir, "workflow.toml"), local: join(p.dir, "none.toml") }).config;
  expect(runCheck(p.dir, c, "test").code).toBe(0);
});

test("B9 + B10 + B11: allowed guard calls, format skips and the router nudge are logged at debug", () => {
  const p = project('[checks]\nformat = "true"\n');
  hook(p, "guard", { tool_name: "Edit", tool_input: { file_path: "a.txt" } });
  hook(p, "format-hook", { tool_name: "Edit", tool_input: { file_path: "a.txt" } });
  hook(p, "context", {});
  const log = events(p.dir);
  expect(log).toContain('"guard.allow"');
  expect(log).toContain("format-hook skipped: checks.format comes from the project layer");
  expect(log).toContain('"nudge"');

  const trusted = project("", '[checks]\nformat = "true"\n');
  hook(trusted, "format-hook", { tool_name: "Edit", tool_input: { file_path: "a.txt" } });
  expect(events(trusted.dir)).toContain("format-hook ran: checks.format passed");
});

test("B12: quoted data next to read-only commands, and cat heredocs, don't deny", () => {
  const c = resolve(tmp("saw-rp-"), {}, {}).config;
  expect(guardCommand(c, `cd /x && claude -p "do ${RMRF} ./gone" > out.txt; tail -5 out.txt`)?.reason ?? "").not.toContain("deny list");
  expect(guardCommand(c, `cat >> notes.md <<'EOF'\nnever ${RMRF} here\nEOF`)).toBeUndefined();
  // Still live: piped heredocs, unquoted delimiters and a shell on the line.
  expect(guardCommand(c, `cat <<'EOF' | sh\n${RMRF} /\nEOF`)?.decision).toBe("deny");
  expect(guardCommand(c, `cat > x <<EOF\n$(${RMRF} /)\nEOF`)?.decision).toBe("deny");
  expect(guardCommand(c, `cd /x && sh -c "${RMRF} /"`)?.decision).toBe("deny");
});

test("B13: init guesses project.type from the repo's manifests", () => {
  const api = tmp("saw-rp-");
  mkdirSync(join(api, "application", "backend"), { recursive: true });
  writeFileSync(join(api, "application", "backend", "pyproject.toml"), '[project]\ndependencies = ["fastapi==0.1"]\n');
  mkdirSync(join(api, "infra"));
  writeFileSync(join(api, "infra", "main.tf"), "");
  expect(guessType(api)).toEqual({ type: "api", from: "application/backend/pyproject.toml" });

  const infra = tmp("saw-rp-");
  writeFileSync(join(infra, "main.tf"), "");
  expect(guessType(infra)?.type).toBe("infra");
  expect(guessType(tmp("saw-rp-"))).toBeUndefined();
});
