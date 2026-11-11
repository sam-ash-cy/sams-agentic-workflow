// saw dashboard --serve: the live dashboard's socket. Listens on 127.0.0.1 only. Inside the
// optional container (SAW_DASHBOARD_IN_CONTAINER=1 and /.dockerenv present) it binds 0.0.0.0;
// compose publishes it on 127.0.0.1 only, and there the page is read-only.
//
// Any process on this machine can reach a loopback port, so the page is not served to just
// anyone. Starting the server prints an address with a one-time launch code; the first request
// that presents it gets a session cookie (HttpOnly, SameSite=Strict) and the code stops
// working. Every later request, reads included, needs that cookie. On top of that, a write
// (POST /api/*) must come from the dashboard's own origin and carry the page's csrf key.
// dashboard-settings.ts has the routes.

import { randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { apiGet, apiPost, claudeConfigDir, findTarget, logHere, projectList, statsFor, type DashboardCtx } from "./dashboard-settings";
import { renderApp } from "./dashboard-page";
import { dataVersion } from "./dashboard";
import type { Table } from "./defaults";
import { layerPaths } from "./config";
import { registerProject, sawHome } from "./projects";

const PLUGIN_ROOT = join(import.meta.dir, "..", "..");
const SESSION = "saw_session";
const newId = (): string => randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
const same = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const launchCodes = new WeakMap<object, string>();

// The address to open: carries the launch code the first request trades for a session cookie.
export const dashboardUrl = (server: ReturnType<typeof Bun.serve>): string => `http://127.0.0.1:${server.port}/?k=${launchCodes.get(server) ?? ""}`;

export function serveDashboard(cwd: string, config: Table, port: number, opts: { home?: string; claudeDir?: string; readOnly?: boolean } = {}): ReturnType<typeof Bun.serve> {
  const inContainer = process.env.SAW_DASHBOARD_IN_CONTAINER === "1" && existsSync("/.dockerenv");
  const ctx: DashboardCtx = { cwd, config, home: opts.home ?? sawHome(), claudeDir: opts.claudeDir ?? claudeConfigDir(), pluginRoot: PLUGIN_ROOT, readOnly: opts.readOnly ?? inContainer };
  // Started inside a saw project: remember it, and open on it.
  if (existsSync(layerPaths(cwd, ctx.home).project)) registerProject(cwd, ctx.home);
  let launchCode: string | undefined = newId();
  const sessionId = newId();
  const launchKey = newId();
  const headers = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
  };
  const withHeaders = (res: Response): Response => {
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return res;
  };
  const denied = (status: number, why: string): Response => {
    logHere(ctx, "warn", "dashboard.rejected", why);
    return withHeaders(Response.json({ ok: false, problem: why }, { status }));
  };
  const hasSession = (req: Request): boolean => {
    const mine = (req.headers.get("cookie") ?? "").split(";").map((c) => c.trim()).find((c) => c.startsWith(`${SESSION}=`));
    return mine !== undefined && same(mine.slice(SESSION.length + 1), sessionId);
  };
  const server: ReturnType<typeof Bun.serve> = Bun.serve({
    hostname: inContainer ? "0.0.0.0" : "127.0.0.1",
    port,
    // Bigger bodies are refused by the server before they are read.
    maxRequestBodySize: 64 * 1024,
    async fetch(req) {
      // DNS rebinding: only answer requests addressed to a loopback name.
      const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
      if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) return new Response("forbidden", { status: 403, headers });
      const url = new URL(req.url);
      const path = url.pathname;
      try {
        if (!hasSession(req)) {
          const given = url.searchParams.get("k");
          if (req.method === "GET" && path === "/" && launchCode && given && same(given, launchCode)) {
            launchCode = undefined;
            return new Response(null, { status: 302, headers: { ...headers, location: "/", "set-cookie": `${SESSION}=${sessionId}; HttpOnly; SameSite=Strict; Path=/` } });
          }
          return req.method === "POST" ? denied(403, "no dashboard session: open the address saw dashboard --serve printed") : new Response("forbidden: open the address saw dashboard --serve printed", { status: 403, headers });
        }
        if (req.method === "POST" && path.startsWith("/api/")) {
          if (ctx.readOnly) return denied(403, "the dashboard is read-only here");
          const origin = req.headers.get("origin") ?? "";
          if (![`http://127.0.0.1:${server.port}`, `http://localhost:${server.port}`].includes(origin)) return denied(403, "the request did not come from the dashboard page");
          if (!same(req.headers.get("x-saw-csrf") ?? "", launchKey)) return denied(403, "missing or wrong csrf key");
          return withHeaders(await apiPost(ctx, req));
        }
        if (req.method !== "GET") return new Response("method not allowed", { status: 405, headers });
        if (path === "/version") {
          const target = findTarget(ctx, url.searchParams.get("project") ?? "global");
          return new Response(dataVersion(target?.path ?? cwd), { headers: { ...headers, "content-type": "text/plain" } });
        }
        if (path.startsWith("/api/")) return withHeaders(apiGet(ctx, url));
        if (path !== "/") return new Response("not found", { status: 404, headers });
        const target = findTarget(ctx, url.searchParams.get("project") ?? projectList(ctx).current) ?? findTarget(ctx, "global")!;
        const html = renderApp({ token: launchKey, writable: !ctx.readOnly, current: target.id, stats: statsFor(ctx, target) });
        return new Response(html, { headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
      } catch (e) {
        return new Response(`dashboard error: ${(e as Error).message}`, { status: 500, headers });
      }
    },
  });
  launchCodes.set(server, launchCode!);
  return server;
}
