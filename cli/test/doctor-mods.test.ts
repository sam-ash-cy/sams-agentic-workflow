import { expect, test } from "bun:test";
import { modsReport } from "../src/main";

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
