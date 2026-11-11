// The settings dashboard's API: reads, writes and what protects the writes. Every server
// binds port 0 and is stopped in afterEach; nothing here reads stdin or waits on a network.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isKnownKey, resolve } from "../src/config";
import { DEFAULTS, DESCRIPTIONS, type Table } from "../src/defaults";
import { readEvents } from "../src/events";
import { guardCommand } from "../src/guard";
import { dashboardUrl } from "../src/dashboard-server";
import { serveDashboard } from "../src/main";
import { registerProject } from "../src/projects";

let server: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => server?.stop(true));

interface Setup {
  dir: string;
  home: string;
  claudeDir: string;
  base: string;
  token: string;
  cookie: string;
  serveDir: string;
}

// The session cookie of the server under test; every request carries it.
let cookie = "";
const f = (url: string, init: RequestInit = {}): Promise<Response> => fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), cookie } });

const tmp = (name: string): string => mkdtempSync(join(tmpdir(), `saw-dash-${name}-`));

async function start(opts: { readOnly?: boolean; toml?: string; plainCwd?: boolean } = {}): Promise<Setup> {
  const dir = tmp("proj");
  const home = tmp("home");
  const claudeDir = tmp("claude");
  writeFileSync(join(dir, "workflow.toml"), opts.toml ?? "# project settings\n[features]\ngrilling = true\n");
  mkdirSync(join(dir, ".git"));
  registerProject(dir, home);
  const config = resolve(dir, {}, { global: join(home, "config.toml"), project: join(dir, "workflow.toml"), local: join(dir, "workflow.local.toml") }).config;
  const serveDir = opts.plainCwd ? tmp("plain") : dir;
  server = serveDashboard(serveDir, config, 0, { home, claudeDir, readOnly: opts.readOnly });
  const base = `http://127.0.0.1:${server.port}`;
  cookie = "";
  const login = await fetch(dashboardUrl(server), { redirect: "manual" });
  cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const page = await (await f(`${base}/`)).text();
  const token = /<meta name="saw-token" content="([^"]*)">/.exec(page)?.[1] ?? "";
  return { dir, home, claudeDir, base, token, cookie, serveDir };
}

const post = (s: Setup, path: string, body: unknown, over: { token?: string | null; origin?: string | null; host?: string; noPath?: boolean; path?: string } = {}): Promise<Response> => {
  // The page sends the folder's path with the project's position; so does every test.
  const b = body as Record<string, unknown>;
  if (!over.noPath && typeof b.project === "string" && b.project !== "global" && b.path === undefined) body = { ...b, path: over.path ?? s.dir };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (over.token !== null) headers["x-saw-csrf"] = over.token ?? s.token;
  if (over.origin !== null) headers.origin = over.origin ?? s.base;
  if (over.host) headers.host = over.host;
  return f(`${s.base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
};

const get = async <T>(s: Setup, path: string): Promise<T> => (await (await f(`${s.base}${path}`)).json()) as T;

interface Row {
  key: string;
  type: string;
  description: string;
  default: unknown;
  value: unknown;
  source: string;
  layer?: unknown;
  blocked?: unknown[];
  options?: string[];
  note?: string;
}

test("every built-in key has a description", () => {
  const keys: string[] = [];
  const walk = (t: Table, prefix = ""): void => {
    for (const [k, v] of Object.entries(t)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) walk(v as Table, key);
      else keys.push(key);
    }
  };
  walk(DEFAULTS);
  expect(keys.filter((k) => !DESCRIPTIONS[k]?.trim())).toEqual([]);
  // No description for a key that no longer exists.
  expect(Object.keys(DESCRIPTIONS).filter((k) => !keys.includes(k))).toEqual([]);
});

test("a key path cannot reach the prototype chain", () => {
  for (const key of ["verify.__proto__.run", "models.roles.__proto__", "verify.constructor.run", "checks.prototype"]) {
    expect(isKnownKey(key)).toBe(false);
  }
  expect(isKnownKey("verify.standard.run")).toBe(true);
});

test("the served page carries a per-launch token and the project list, and writes go through the API only", async () => {
  const s = await start();
  expect(s.token.length).toBeGreaterThanOrEqual(32);
  const page = await f(`${s.base}/`);
  expect(page.headers.get("content-security-policy")).toContain("connect-src 'self'");
  const html = await page.text();
  expect(html).toContain("Workflow metrics");
  // The page's script sends the key back in the header the server checks.
  expect(html).toContain('headers.set("x-saw-csrf", document.querySelector("meta[name=saw-token]").content)');
  // A second launch gets another token.
  server?.stop(true);
  const again = await start();
  expect(again.token).not.toBe(s.token);
});

test("/api/projects lists Global first, then the registry with each project's state", async () => {
  const s = await start();
  const list = await get<{ writable: boolean; current: string; projects: { id: string; name: string; state: string; summary: string }[] }>(s, "/api/projects");
  expect(list.writable).toBe(true);
  expect(list.projects[0]).toMatchObject({ id: "global", name: "Global" });
  expect(list.projects[1]).toMatchObject({ id: "0", state: "ready" });
  expect(list.current).toBe("0");
  const empty = tmp("empty");
  registerProject(empty, s.home);
  const next = await get<{ projects: { id: string; state: string }[] }>(s, "/api/projects");
  expect(next.projects.find((p) => p.id === "1")?.state).toBe("not set up");
});

test("/api/settings gives every key a type, a description, its default and where the value comes from", async () => {
  const s = await start();
  const { rows } = await get<{ rows: Row[] }>(s, "/api/settings?project=global");
  const byKey = new Map(rows.map((r) => [r.key, r]));
  expect(byKey.get("features.grilling")).toMatchObject({ type: "boolean", default: true, value: true, source: "default" });
  expect(byKey.get("safety.push")).toMatchObject({ type: "enum", options: ["never", "ask", "allow"] });
  expect(byKey.get("autonomy.actions.commit")?.options).toEqual(["never", "ask", "propose", "allow"]);
  expect(byKey.get("routing.trivial_max_files")?.type).toBe("number");
  expect(byKey.get("agents.enabled")?.type).toBe("list");
  expect(byKey.get("branch.base")?.type).toBe("text");
  expect(rows.filter((r) => !r.description).map((r) => r.key)).toEqual([]);
  const project = await get<{ rows: Row[] }>(s, "/api/settings?project=0&scope=project");
  expect(project.rows.find((r) => r.key === "features.grilling")).toMatchObject({ source: "project", layer: true });
});

test("writes need the token, the dashboard's own origin and a loopback host", async () => {
  const s = await start();
  const body = { project: "global", scope: "global", key: "features.trail", value: true };
  expect((await post(s, "/api/settings", body, { token: null })).status).toBe(403);
  expect((await post(s, "/api/settings", body, { token: "wrong" })).status).toBe(403);
  expect((await post(s, "/api/settings", body, { origin: "http://evil.example" })).status).toBe(403);
  expect((await post(s, "/api/settings", body, { origin: `http://127.0.0.1:${server!.port! + 1}` })).status).toBe(403);
  expect((await post(s, "/api/settings", body, { origin: null })).status).toBe(403);
  expect((await post(s, "/api/settings", body, { host: "evil.example" })).status).toBe(403);
  expect(existsSync(join(s.home, "config.toml"))).toBe(false);
  expect((await post(s, "/api/settings", body)).status).toBe(200);
  expect((await post(s, "/api/settings", body, { origin: `http://localhost:${server!.port}` })).status).toBe(200);
});

test("container mode is read-only: the page says so and every write is refused", async () => {
  const s = await start({ readOnly: true });
  expect((await get<{ writable: boolean }>(s, "/api/projects")).writable).toBe(false);
  const res = await post(s, "/api/settings", { project: "global", scope: "global", key: "features.trail", value: true });
  expect(res.status).toBe(403);
  expect(existsSync(join(s.home, "config.toml"))).toBe(false);
});

test("a write lands in the layer file it names, and nowhere else", async () => {
  const s = await start();
  const ok = await post(s, "/api/settings", { project: "global", scope: "global", key: "features.trail", value: true });
  expect(await ok.json()).toMatchObject({ ok: true, row: { key: "features.trail", value: true, source: "global" } });
  expect(readFileSync(join(s.home, "config.toml"), "utf8")).toContain("trail = true");

  expect((await post(s, "/api/settings", { project: "0", scope: "project", key: "features.metrics", value: false })).status).toBe(200);
  const shared = readFileSync(join(s.dir, "workflow.toml"), "utf8");
  expect(shared).toContain("# project settings");
  expect(shared).toContain("metrics = false");
  expect(existsSync(join(s.dir, "workflow.local.toml"))).toBe(false);

  expect((await post(s, "/api/settings", { project: "0", scope: "local", key: "safety.push", value: "allow" })).status).toBe(200);
  expect(readFileSync(join(s.dir, "workflow.local.toml"), "utf8")).toContain('push = "allow"');
  expect(readFileSync(join(s.dir, "workflow.toml"), "utf8")).not.toContain("allow");
});

test("bad writes are 400: unknown key, wrong type, bad enum, wrong scope for the project", async () => {
  const s = await start();
  const send = (b: Record<string, unknown>) => post(s, "/api/settings", { project: "0", scope: "local", ...b });
  expect((await send({ key: "nope.nothing", value: true })).status).toBe(400);
  expect((await send({ key: "verify.__proto__.run", value: ["x"] })).status).toBe(400);
  expect((await send({ key: "features.trail", value: "yes" })).status).toBe(400);
  expect((await send({ key: "safety.push", value: "sometimes" })).status).toBe(400);
  expect((await send({ key: "routing.trivial_max_files", value: "many" })).status).toBe(400);
  expect((await send({ key: "agents.enabled", value: [{ a: 1 }] })).status).toBe(400);
  expect((await send({ key: "features.trail", value: true, scope: "global" })).status).toBe(400);
  expect((await post(s, "/api/settings", { project: "global", scope: "local", key: "features.trail", value: true })).status).toBe(400);
  expect((await send({ key: "features.trail" })).status).toBe(400);
  expect(existsSync(join(s.dir, "workflow.local.toml"))).toBe(false);
});

test("the shared project file may not weaken a guard setting; the same value is fine in only-me", async () => {
  const s = await start();
  const before = readFileSync(join(s.dir, "workflow.toml"), "utf8");
  const refused = await post(s, "/api/settings", { project: "0", scope: "project", key: "safety.push", value: "allow" });
  expect(refused.status).toBe(400);
  expect(((await refused.json()) as { problem: string }).problem).toContain("Only me");
  expect(readFileSync(join(s.dir, "workflow.toml"), "utf8")).toBe(before);
  // Tightening is allowed there.
  expect((await post(s, "/api/settings", { project: "0", scope: "project", key: "autonomy.actions.commit", value: "never" })).status).toBe(200);
  // The row says which values the shared file cannot take.
  const { rows } = await get<{ rows: Row[] }>(s, "/api/settings?project=0&scope=project");
  expect(rows.find((r) => r.key === "safety.push")?.blocked).toEqual(["ask", "allow"]);
  expect(rows.find((r) => r.key === "features.parallel_sessions")?.blocked).toEqual([true]);
  expect(rows.find((r) => r.key === "features.grilling")?.blocked ?? []).toEqual([]);
  const local = await get<{ rows: Row[] }>(s, "/api/settings?project=0&scope=local");
  expect(local.rows.find((r) => r.key === "safety.push")?.blocked ?? []).toEqual([]);
});

test("reset removes the key from that layer only, and says so when it was not set", async () => {
  const s = await start();
  await post(s, "/api/settings", { project: "0", scope: "local", key: "features.trail", value: true });
  const reset = await post(s, "/api/settings", { project: "0", scope: "local", key: "features.trail", unset: true });
  expect(await reset.json()).toMatchObject({ ok: true, row: { key: "features.trail", value: false, source: "default" } });
  expect(readFileSync(join(s.dir, "workflow.local.toml"), "utf8")).not.toContain("trail");
  const again = await post(s, "/api/settings", { project: "0", scope: "local", key: "features.trail", unset: true });
  expect(again.status).toBe(400);
});

test("a project id is an index into the list, never a path", async () => {
  const s = await start();
  for (const project of ["7", "-1", "1.5", "../..", s.dir, "constructor"]) {
    expect((await post(s, "/api/settings", { project, scope: "project", key: "features.trail", value: true })).status).toBe(404);
  }
  expect((await f(`${s.base}/api/settings?project=${encodeURIComponent(s.dir)}`)).status).toBe(404);
});

test("every change is logged with the key, the layer and the old and new value", async () => {
  const s = await start();
  await post(s, "/api/settings", { project: "0", scope: "local", key: "style.max_words", value: 120 });
  await post(s, "/api/settings", { project: "0", scope: "local", key: "style.max_words", value: 90 });
  const events = readEvents(s.dir).filter((e) => e.kind === "settings.changed");
  expect(events.length).toBe(2);
  expect(events[1]!.data).toMatchObject({ key: "style.max_words", scope: "local", from: 120, to: 90, via: "dashboard" });
  // A refused write is not a change.
  await post(s, "/api/settings", { project: "0", scope: "project", key: "safety.push", value: "allow" });
  expect(readEvents(s.dir).filter((e) => e.kind === "settings.changed").length).toBe(2);
});

test("a global change is logged in the folder the dashboard runs from", async () => {
  const s = await start();
  await post(s, "/api/settings", { project: "global", scope: "global", key: "style.max_words", value: 100 });
  expect(readEvents(s.dir).some((e) => e.kind === "settings.changed" && (e.data as { scope: string }).scope === "global")).toBe(true);
});

test("projects can be added, set up and forgotten from the page, and forgetting deletes nothing", async () => {
  const s = await start();
  const folder = tmp("new");
  writeFileSync(join(folder, "keep.txt"), "mine");
  const add = await post(s, "/api/projects", { action: "add", path: folder });
  expect(await add.json()).toMatchObject({ ok: true, state: "not set up" });
  const id = (await get<{ projects: { id: string; path: string }[] }>(s, "/api/projects")).projects.find((p) => p.path.toLowerCase() === folder.toLowerCase())!.id;
  // Not set up yet: no settings to write.
  expect((await post(s, "/api/settings", { project: id, path: folder, scope: "project", key: "features.trail", value: true })).status).toBe(400);
  expect((await post(s, "/api/projects", { action: "setup", project: id, path: folder })).status).toBe(200);
  expect(existsSync(join(folder, "workflow.toml"))).toBe(true);
  expect((await post(s, "/api/projects", { action: "remove", project: id, path: folder })).status).toBe(200);
  expect(readFileSync(join(folder, "keep.txt"), "utf8")).toBe("mine");
  expect(existsSync(join(folder, "workflow.toml"))).toBe(true);
  expect((await post(s, "/api/projects", { action: "add", path: join(folder, "does", "not", "exist") })).status).toBe(400);
  expect((await post(s, "/api/projects", { action: "explode" })).status).toBe(400);
});

test("mods: state comes from the Claude settings files, and a switch writes the right one", async () => {
  const s = await start();
  const user = join(s.claudeDir, "settings.json");
  writeFileSync(user, JSON.stringify({ theme: "dark", enabledPlugins: { "prompt-band@sams-agentic-workflow": true, "trail-nudge@sams-agentic-workflow": false } }, null, 2));
  const globalMods = await get<{ writable: boolean; mods: { name: string; description: string; state: string }[] }>(s, "/api/mods?project=global");
  const byName = new Map(globalMods.mods.map((m) => [m.name, m]));
  expect(byName.get("prompt-band")).toMatchObject({ state: "enabled" });
  expect(byName.get("prompt-band")!.description).toContain("Buttons above the prompt");
  expect(byName.get("trail-nudge")?.state).toBe("disabled");
  expect(byName.get("context-guard")?.state).toBe("not installed");

  expect((await post(s, "/api/mods", { project: "global", name: "prompt-band", enabled: false })).status).toBe(200);
  const written = JSON.parse(readFileSync(user, "utf8"));
  expect(written.theme).toBe("dark");
  expect(written.enabledPlugins["prompt-band@sams-agentic-workflow"]).toBe(false);

  // For a project the switch goes to .claude/settings.local.json and inherits the global state.
  const inherited = await get<{ mods: { name: string; state: string }[] }>(s, "/api/mods?project=0");
  expect(inherited.mods.find((m) => m.name === "trail-nudge")?.state).toBe("disabled");
  expect((await post(s, "/api/mods", { project: "0", name: "trail-nudge", enabled: true })).status).toBe(200);
  expect(JSON.parse(readFileSync(join(s.dir, ".claude", "settings.local.json"), "utf8")).enabledPlugins["trail-nudge@sams-agentic-workflow"]).toBe(true);
  expect(JSON.parse(readFileSync(user, "utf8")).enabledPlugins["trail-nudge@sams-agentic-workflow"]).toBe(false);
});

test("mods: not installed, unknown and malformed requests are refused and write nothing", async () => {
  const s = await start();
  const user = join(s.claudeDir, "settings.json");
  expect((await post(s, "/api/mods", { project: "global", name: "context-guard", enabled: true })).status).toBe(400);
  expect((await post(s, "/api/mods", { project: "global", name: "../../etc", enabled: true })).status).toBe(400);
  expect((await post(s, "/api/mods", { project: "global", name: "prompt-band", enabled: "yes" })).status).toBe(400);
  expect(existsSync(user)).toBe(false);
  writeFileSync(user, "{ not json");
  expect((await post(s, "/api/mods", { project: "global", name: "prompt-band", enabled: true })).status).toBe(400);
  expect(readFileSync(user, "utf8")).toBe("{ not json");
});

test("only POST /api/* writes: other methods and paths stay refused", async () => {
  const s = await start();
  expect((await f(`${s.base}/`, { method: "POST" })).status).toBe(405);
  expect((await f(`${s.base}/api/settings`, { method: "DELETE" })).status).toBe(405);
  expect((await f(`${s.base}/api/settings`, { method: "PUT" })).status).toBe(405);
  expect((await post(s, "/api/unknown", {})).status).toBe(404);
  const big = await f(`${s.base}/api/settings`, { method: "POST", headers: { "x-saw-csrf": s.token, origin: s.base, "content-type": "application/json" }, body: "x".repeat(200_000) });
  expect(big.status).toBe(413);
  const junk = await f(`${s.base}/api/settings`, { method: "POST", headers: { "x-saw-csrf": s.token, origin: s.base, "content-type": "application/json" }, body: "{nope" });
  expect(junk.status).toBe(400);
});

test("saw guard denies an agent command that talks to the dashboard API", () => {
  const denied = [
    `curl -X POST http://127.0.0.1:4173/api/settings -H "x-saw-csrf: abc" -d '{}'`,
    "curl.exe -s -X POST http://localhost:4173/api/mods",
    `Invoke-RestMethod -Method Post -Uri http://localhost:4173/api/settings -Body $b`,
    `irm http://[::1]:4173/api/projects`,
    `bun -e "fetch('http://127.0.0.1:4173/api/settings',{method:'POST'})"`,
    `curl -H "x-saw-csrf: abc" http://example.com/`,
  ];
  for (const command of denied) expect(guardCommand(DEFAULTS, command, process.cwd()).decision).toBe("deny");
  for (const command of ["curl http://localhost:3000/health", "curl https://example.com/api/settings", "bun run test", "saw dashboard --serve", "grep -rn saw-csrf cli/", "git log -S x-saw-csrf --oneline"]) {
    expect(guardCommand(DEFAULTS, command, process.cwd())?.decision).not.toBe("deny");
  }
});

beforeEach(() => {
  server = undefined;
});

test("nothing is served without the session cookie, and the launch code works once", async () => {
  const s = await start();
  const bare = (path: string, init: RequestInit = {}): Promise<Response> => fetch(`${s.base}${path}`, init);
  for (const path of ["/", "/api/projects", "/api/settings?project=global", "/version"]) expect((await bare(path)).status).toBe(403);
  const body = { project: "global", scope: "global", key: "features.trail", value: true };
  const noCookie = await bare("/api/settings", { method: "POST", headers: { "content-type": "application/json", "x-saw-csrf": s.token, origin: s.base }, body: JSON.stringify(body) });
  expect(noCookie.status).toBe(403);
  expect((await fetch(`${s.base}/api/projects`, { headers: { cookie: "saw_session=guess" } })).status).toBe(403);
  // The code in the address was used by start(); it does not work a second time, and a wrong one never does.
  expect((await fetch(dashboardUrl(server!), { redirect: "manual" })).status).toBe(403);
  expect((await fetch(`${s.base}/?k=nope`, { redirect: "manual" })).status).toBe(403);
  expect(existsSync(join(s.home, "config.toml"))).toBe(false);
  expect(s.cookie).toContain("saw_session=");
});

test("a write names the project's folder as well as its position, and a mismatch is refused", async () => {
  const s = await start();
  const body = { project: "0", scope: "local", key: "features.trail", value: true };
  expect((await post(s, "/api/settings", body, { noPath: true })).status).toBe(409);
  expect((await post(s, "/api/settings", body, { path: tmp("other") })).status).toBe(409);
  expect((await post(s, "/api/mods", { project: "0", name: "prompt-band", enabled: true }, { noPath: true })).status).toBe(409);
  expect((await post(s, "/api/projects", { action: "remove", project: "0" }, { path: tmp("other") })).status).toBe(409);
  expect(existsSync(join(s.dir, "workflow.local.toml"))).toBe(false);
});

test("a project whose folder is gone, or whose settings do not parse, takes no writes", async () => {
  const s = await start();
  const gone = tmp("gone");
  writeFileSync(join(gone, "workflow.toml"), "");
  await post(s, "/api/projects", { action: "add", path: gone });
  const id = (await get<{ projects: { id: string; path: string }[] }>(s, "/api/projects")).projects.find((p) => p.path === gone)!.id;
  rmSync(gone, { recursive: true });
  const res = await post(s, "/api/settings", { project: id, path: gone, scope: "local", key: "features.trail", value: true });
  expect(res.status).toBe(400);
  expect(existsSync(gone)).toBe(false);
  const broken = tmp("broken");
  writeFileSync(join(broken, "workflow.toml"), "[features\nnot toml");
  await post(s, "/api/projects", { action: "add", path: broken });
  const bid = (await get<{ projects: { id: string; path: string }[] }>(s, "/api/projects")).projects.find((p) => p.path === broken)!.id;
  expect((await post(s, "/api/settings", { project: bid, path: broken, scope: "local", key: "features.trail", value: true })).status).toBe(400);
  expect(existsSync(join(broken, "workflow.local.toml"))).toBe(false);
});

test("events are not written into a folder that is not a saw project", async () => {
  const s = await start({ plainCwd: true });
  expect((await post(s, "/api/settings", { project: "global", scope: "global", key: "style.max_words", value: 100 })).status).toBe(200);
  await fetch(`${s.base}/api/settings`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  expect(existsSync(join(s.serveDir, ".saw"))).toBe(false);
});

test("Set up does what saw init does: guesses the type and adds the dep audit", async () => {
  const s = await start();
  const folder = tmp("api");
  writeFileSync(join(folder, "package.json"), JSON.stringify({ dependencies: { express: "4.0.0" } }));
  writeFileSync(join(folder, "bun.lock"), "");
  await post(s, "/api/projects", { action: "add", path: folder });
  const id = (await get<{ projects: { id: string; path: string }[] }>(s, "/api/projects")).projects.find((p) => p.path === folder)!.id;
  expect((await post(s, "/api/projects", { action: "setup", project: id, path: folder })).status).toBe(200);
  const toml = readFileSync(join(folder, "workflow.toml"), "utf8");
  expect(toml).toContain('type = "api"');
  expect(toml).toContain("dep_audit");
});

test("number settings are range-checked and the field carries the range", async () => {
  const s = await start();
  const send = (key: string, value: unknown) => post(s, "/api/settings", { project: "0", scope: "local", key, value });
  for (const [key, value] of [["tokens.warn_at", 99], ["context.window_tokens", 0], ["dashboard.port", 70000], ["routing.trivial_max_files", -1], ["context.autocompact_window", 500], ["context.suggest_compact_at", [2]]] as const) {
    expect((await send(key, value as unknown)).status).toBe(400);
  }
  for (const [key, value] of [["tokens.warn_at", 0.5], ["context.window_tokens", 200000], ["dashboard.port", 4173], ["context.autocompact_window", 0], ["context.suggest_compact_at", [0.4, 0.8]]] as const) {
    expect((await send(key, value as unknown)).status).toBe(200);
  }
  const { rows } = await get<{ rows: (Row & { min?: number; max?: number })[] }>(s, "/api/settings?project=0&scope=local");
  expect(rows.find((r) => r.key === "tokens.warn_at")).toMatchObject({ min: 0, max: 1 });
  expect(rows.find((r) => r.key === "dashboard.port")).toMatchObject({ min: 1, max: 65535 });
});
