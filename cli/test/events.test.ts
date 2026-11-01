// The unified event log (.saw/events.jsonl) and the live dashboard server.

import { afterEach, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { eventsHtml, renderHtml } from "../src/dashboard";
import type { Table } from "../src/defaults";
import { eventsPath, logEvent, readEvents } from "../src/events";
import { serveDashboard } from "../src/main";

const MAIN = join(import.meta.dir, "..", "src", "main.ts");

function project(toml = ""): { dir: string; config: Table } {
  const dir = mkdtempSync(join(tmpdir(), "saw-ev-"));
  writeFileSync(join(dir, "workflow.toml"), toml);
  const none = join(dir, "none.toml");
  return { dir, config: resolve(dir, {}, { global: none, project: join(dir, "workflow.toml"), local: none }).config };
}

test("logEvent appends one JSON line per event; readEvents returns the last N", () => {
  const { dir, config } = project();
  logEvent(dir, config, "info", "tier", "standard / feature", { tier: "standard" });
  logEvent(dir, config, "warn", "gate.block", "tests not run");
  expect(readEvents(dir).map((e) => e.kind)).toEqual(["tier", "gate.block"]);
  expect(readEvents(dir, 1)[0]!.message).toBe("tests not run");
  expect(readEvents(dir)[0]!.data).toEqual({ tier: "standard" });
});

test("[logging] enabled and level gate what is written", () => {
  const off = project("[logging]\nenabled = false\n");
  expect(logEvent(off.dir, off.config, "warn", "gate.block", "x")).toBe(false);
  expect(readEvents(off.dir)).toEqual([]);
  const warn = project('[logging]\nlevel = "warn"\n');
  expect(logEvent(warn.dir, warn.config, "info", "check", "pass")).toBe(false);
  expect(logEvent(warn.dir, warn.config, "warn", "check", "fail")).toBe(true);
  const info = project();
  expect(logEvent(info.dir, info.config, "debug", "format", "ran")).toBe(false);
  const debug = project('[logging]\nlevel = "debug"\n');
  expect(logEvent(debug.dir, debug.config, "debug", "format", "ran")).toBe(true);
});

test("readEvents skips malformed lines", () => {
  const { dir, config } = project();
  logEvent(dir, config, "info", "tier", "ok");
  appendFileSync(eventsPath(dir), 'not json\n{"no":"kind"}\n');
  expect(readEvents(dir)).toHaveLength(1);
});

test("saw task start, guard and gate write events", () => {
  const { dir } = project();
  const saw = (argv: string[], stdin = ""): void => {
    Bun.spawnSync(["bun", MAIN, ...argv], { cwd: dir, stdin: Buffer.from(stdin), stdout: "pipe", stderr: "pipe" });
  };
  saw(["task", "start", "--tier", "standard", "--playbook", "feature"]);
  saw(["guard"], JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push --force origin main" } }));
  saw(["gate"], "{}");
  const kinds = readEvents(dir).map((e) => e.kind);
  expect(kinds[0]).toBe("tier");
  expect(kinds.some((k) => k.startsWith("guard."))).toBe(true);
  expect(kinds).toContain("gate.block");
});

test("the events panel escapes every field and follows [dashboard].panels", () => {
  const evil = { at: "2026-11-01T10:00:00.000Z", level: "warn" as const, kind: "<img src=x onerror=alert(1)>", message: "<script>alert(1)</script>\"'&" };
  const html = eventsHtml([evil]);
  expect(html).not.toContain("<script>alert");
  expect(html).not.toContain("<img");
  expect(html).toContain("&#60;script&#62;");
  expect(renderHtml([], ["outcomes", "events"], [], new Date(), [evil])).toContain("<h2>Events</h2>");
  expect(renderHtml([], ["outcomes"], [], new Date(), [evil])).not.toContain("<h2>Events</h2>");
  // The static page carries no script; only the served one polls for changes.
  expect(renderHtml([], ["events"], [], new Date(), [])).not.toContain("<script");
  expect(renderHtml([], ["events"], [], new Date(), [], true)).toContain("/version");
});

let server: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => server?.stop(true));

test("saw dashboard --serve listens on 127.0.0.1, refuses other hosts, and /version changes with events", async () => {
  const { dir, config } = project();
  server = serveDashboard(dir, config, 0);
  expect(server.hostname).toBe("127.0.0.1");
  const base = `http://127.0.0.1:${server.port}`;
  const page = await fetch(`${base}/`);
  expect(page.status).toBe(200);
  expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
  expect(await page.text()).toContain("Workflow metrics");
  const v1 = await (await fetch(`${base}/version`)).text();
  logEvent(dir, config, "info", "tier", "standard / feature");
  const v2 = await (await fetch(`${base}/version`)).text();
  expect(v2).not.toBe(v1);
  expect(await (await fetch(`${base}/`)).text()).toContain("standard / feature");
  expect((await fetch(`${base}/`, { headers: { host: "evil.example" } })).status).toBe(403);
  expect((await fetch(`${base}/nope`)).status).toBe(404);
  expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(405);
});
