// The Claude Code pane's way in: GET /pane-session?k=<launch code> trades the one-use code for
// the session and csrf key in a JSON body, for a client that cannot read an HttpOnly cookie.
// Every server binds port 0 and is stopped in afterEach; nothing here reads stdin.

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { DEFAULTS } from "../src/defaults";
import { guardCommand } from "../src/guard";
import { dashboardUrl } from "../src/dashboard-server";
import { serveDashboard } from "../src/main";
import { registerProject } from "../src/projects";

let server: ReturnType<typeof Bun.serve> | undefined;
let child: ReturnType<typeof Bun.spawn> | undefined;
afterEach(() => {
  server?.stop(true);
  child?.kill();
  server = undefined;
  child = undefined;
});

const tmp = (name: string): string => mkdtempSync(join(tmpdir(), `saw-pane-${name}-`));

function start(): { base: string; code: string; dir: string } {
  const dir = tmp("proj");
  const home = tmp("home");
  writeFileSync(join(dir, "workflow.toml"), "[features]\ngrilling = true\n");
  mkdirSync(join(dir, ".git"));
  registerProject(dir, home);
  const config = resolve(dir, {}, { global: join(home, "config.toml"), project: join(dir, "workflow.toml"), local: join(dir, "workflow.local.toml") }).config;
  server = serveDashboard(dir, config, 0, { home, claudeDir: tmp("claude") });
  const code = new URL(dashboardUrl(server)).searchParams.get("k") ?? "";
  return { base: `http://127.0.0.1:${server.port}`, code, dir };
}

interface Pane {
  ok: boolean;
  session: string;
  csrf: string;
  writable: boolean;
}

test("the launch code trades for a session and a csrf key that the API accepts", async () => {
  const s = start();
  const res = await fetch(`${s.base}/pane-session?k=${s.code}`);
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const body = (await res.json()) as Pane;
  expect(body.ok).toBe(true);
  expect(body.writable).toBe(true);
  expect(body.session.length).toBeGreaterThanOrEqual(32);
  expect(body.csrf.length).toBeGreaterThanOrEqual(32);
  const cookie = `saw_session=${body.session}`;
  const projects = await fetch(`${s.base}/api/projects`, { headers: { cookie } });
  expect(projects.status).toBe(200);
  // A write still needs the origin and the csrf key, exactly as for the browser page.
  const write = (headers: Record<string, string>): Promise<Response> =>
    fetch(`${s.base}/api/settings`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", ...headers },
      body: JSON.stringify({ project: "global", scope: "global", key: "features.grilling", value: false }),
    });
  expect((await write({ origin: s.base })).status).toBe(403);
  expect((await write({ "x-saw-csrf": body.csrf })).status).toBe(403);
  expect((await write({ origin: "http://evil.example", "x-saw-csrf": body.csrf })).status).toBe(403);
});

test("the launch code works once, for the pane or for the browser, not both", async () => {
  const s = start();
  expect((await fetch(`${s.base}/pane-session?k=${s.code}`)).status).toBe(200);
  expect((await fetch(`${s.base}/pane-session?k=${s.code}`)).status).toBe(403);
  expect((await fetch(`${s.base}/?k=${s.code}`, { redirect: "manual" })).status).toBe(403);
});

test("a wrong or missing code gets nothing, and a browser launch still works after a failed try", async () => {
  const s = start();
  for (const q of ["", "?k=", "?k=nope", `?k=${s.code}x`]) {
    const res = await fetch(`${s.base}/pane-session${q}`);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("csrf");
  }
  const launch = await fetch(`${s.base}/?k=${s.code}`, { redirect: "manual" });
  expect(launch.status).toBe(302);
  expect(launch.headers.get("set-cookie")).toContain("HttpOnly");
});

test("a request already holding a session cannot ask for a second one", async () => {
  const s = start();
  const first = (await (await fetch(`${s.base}/pane-session?k=${s.code}`)).json()) as Pane;
  const again = await fetch(`${s.base}/pane-session?k=${s.code}`, { headers: { cookie: `saw_session=${first.session}` } });
  expect(again.status).toBe(404);
});

test("the host check applies to the pane route too", async () => {
  const s = start();
  const res = await fetch(`${s.base}/pane-session?k=${s.code}`, { headers: { host: "evil.example" } });
  expect(res.status).toBe(403);
  // The refused request did not use up the code.
  expect((await fetch(`${s.base}/pane-session?k=${s.code}`)).status).toBe(200);
});

test("saw dashboard --serve --port 0 listens on a free port and prints it in the launch address", async () => {
  const dir = tmp("cli");
  writeFileSync(join(dir, "workflow.toml"), "[features]\ndashboard = true\n");
  mkdirSync(join(dir, ".git"));
  const main = join(import.meta.dir, "..", "src", "main.ts");
  child = Bun.spawn([process.execPath, main, "dashboard", "--serve", "--port", "0"], { cwd: dir, stdout: "pipe", stderr: "pipe", env: { ...process.env, SAW_HOME: tmp("cli-home") } });
  const reader = child.stdout.getReader();
  const deadline = Date.now() + 15000;
  let seen = "";
  while (Date.now() < deadline && !/\?k=\w+/.test(seen)) {
    const next = await Promise.race([reader.read(), new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), Math.max(1, deadline - Date.now())))]);
    if (next.done) break;
    seen += new TextDecoder().decode(next.value);
  }
  const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?k=\w{32,}/.exec(seen);
  expect(m).not.toBeNull();
  expect(Number(m![1])).toBeGreaterThan(0);
});

test("saw guard denies an agent command that asks the pane route for a session", () => {
  const ask = (c: string): string | undefined => guardCommand(DEFAULTS, c, process.cwd())?.decision;
  expect(ask("curl http://127.0.0.1:41234/pane-session?k=abc")).toBe("deny");
  expect(ask(`bun -e "fetch('http://localhost:9/pane-session?k=x')"`)).toBe("deny");
  expect(ask("curl https://example.com/pane-session")).not.toBe("deny");
});

test("a write made with what the pane holds goes through, and a read-only server says so", async () => {
  const s = start();
  const body = (await (await fetch(`${s.base}/pane-session?k=${s.code}`)).json()) as Pane;
  const res = await fetch(`${s.base}/api/settings`, {
    method: "POST",
    headers: { cookie: `saw_session=${body.session}`, origin: s.base, "x-saw-csrf": body.csrf, "content-type": "application/json" },
    body: JSON.stringify({ project: "0", path: s.dir, scope: "project", key: "features.grilling", value: false }),
  });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  server?.stop(true);
  const dir = tmp("ro");
  const home = tmp("ro-home");
  const config = resolve(dir, {}, { global: join(home, "config.toml"), project: join(dir, "workflow.toml"), local: join(dir, "workflow.local.toml") }).config;
  server = serveDashboard(dir, config, 0, { home, claudeDir: tmp("ro-claude"), readOnly: true });
  const ro = (await (await fetch(`http://127.0.0.1:${server.port}/pane-session?k=${new URL(dashboardUrl(server)).searchParams.get("k")}`)).json()) as Pane;
  expect(ro.writable).toBe(false);
});
