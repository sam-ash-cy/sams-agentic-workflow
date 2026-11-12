import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { modsReport } from "../src/main";
import { DEFAULT_MODS } from "../src/mods";

const list = "  ❯ prompt-band@sams-agentic-workflow\n    Status: ✔ enabled\n  ❯ workflow-pane@sams-agentic-workflow\n    Status: ✘ disabled\n";

test("doctor reports each mod's state and the host", () => {
  const r = modsReport(list, ["prompt-band", "workflow-pane", "render"], "claude-desktop");
  expect(r.lines[0]).toContain("enabled");
  expect(r.problems).toHaveLength(1);
  expect(r.problems[0]).toContain("claude plugin enable workflow-pane@");
  expect(r.lines[2]).toContain("optional: claude plugin install render@");
  expect(r.lines.at(-1)).toContain("terminal");
  expect(modsReport(list, ["prompt-band"], "cli").lines).toHaveLength(1);
});

test("a default mod that isn't installed is a problem, not an optional note", () => {
  const r = modsReport(list, ["dashboard-pane"], "cli");
  expect(r.lines[0]).toContain("not installed");
  expect(r.lines[0]).not.toContain("optional");
  expect(r.problems[0]).toContain("claude plugin install dashboard-pane@");
});

test("both bootstrap scripts install every default mod", () => {
  for (const f of ["bootstrap.sh", "bootstrap.ps1"]) {
    const text = readFileSync(join(import.meta.dir, "..", "..", f), "utf8");
    for (const m of DEFAULT_MODS) expect(text).toContain(m);
  }
});
