// `saw sanitize`: scan the repo's files for things that must not go public:
// secrets, personal paths, email addresses and the owner's own names. It only
// reports; fixing is a human edit.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import type { Table } from "./defaults";

export interface Finding {
  file: string;
  line: number;
  kind: "secret" | "path" | "email" | "name";
  match: string;
}

// A line holding this marker is skipped (a documented example, a test fixture).
const ALLOW = "saw-sanitize: allow";

const SECRETS: [string, RegExp][] = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ["Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["OpenAI key", /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["secret assignment", /\b(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*["'][^"'\s$<{]{12,}["']/i],
];

// A home folder with a real user name in it. Placeholders (<you>, $USER, ~)
// and CI runner homes don't match.
const PATHS = [
  /\b[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}(?!(?:Public|Default|<|%|\$|USERNAME\b|you\b|me\b|runneradmin\b))[A-Za-z0-9._-]+/i,
  /(?<![\w.])\/(?:Users|home)\/(?!(?:runner|<|\$|you\b|me\b|user\b|USER\b))[a-z0-9._-]+/,
];

const EMAIL = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+([A-Za-z]{2,})\b/g;
// File extensions look like TLDs ("@saw-workflow.md"); skip them.
const NOT_TLD = new Set(["md", "ts", "js", "json", "toml", "yml", "yaml", "sh", "ps1", "txt", "mdc", "lock", "html", "css"]);
const SAFE_EMAIL = /(?:^noreply@|@users\.noreply\.github\.com$|@example\.(?:com|org|net)$|@anthropic\.com$)/i;

// Names too generic to flag (they show up as plain words or CI users).
const GENERIC = new Set(["runner", "root", "user", "admin", "administrator", "runneradmin", "github", "ubuntu", "test"]);

// The owner's own identifiers, taken from this machine rather than a committed
// file (a committed list would publish them): git user.name and email, the OS
// user name, plus `release.names` from the global or local layer.
export function ownerNames(cwd: string, config: Table): string[] {
  const git = (key: string): string =>
    spawnSync("git", ["config", "--get", key], { cwd, encoding: "utf8" }).stdout?.trim() ?? "";
  const email = git("user.email");
  const extra = ((config.release ?? {}) as { names?: string[] }).names ?? [];
  let os = "";
  try {
    os = userInfo().username;
  } catch {
    // No user record (some containers): nothing to add.
  }
  const names = [git("user.name"), email, email.split("@")[0], os, ...extra];
  return [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 3 && !GENERIC.has(n.toLowerCase())))];
}

// Tracked files plus untracked ones git doesn't ignore: what a push would publish.
export function publishedFiles(cwd: string): string[] {
  const out = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd, encoding: "utf8" });
  if (out.status !== 0) throw new Error(`git ls-files failed: ${out.stderr?.trim()}`);
  return [...new Set(out.stdout.split("\0").filter(Boolean))];
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function scanText(file: string, text: string, names: string[], allowed: string[] = []): Finding[] {
  const nameRes = names.map((n) => new RegExp(`(?<![A-Za-z0-9])${escape(n)}(?![A-Za-z0-9])`, "i"));
  const findings: Finding[] = [];
  const allowRes = allowed.map((a) => new RegExp(escape(a), "gi"));
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.includes(ALLOW)) return;
    // Blank out the allowed literals so nothing inside them matches.
    const line = allowRes.reduce((l, re) => l.replace(re, (m) => " ".repeat(m.length)), raw);
    const add = (kind: Finding["kind"], match: string): void => {
      findings.push({ file, line: i + 1, kind, match });
    };
    for (const [label, re] of SECRETS) if (re.test(line)) add("secret", label);
    for (const re of PATHS) {
      const m = re.exec(line);
      if (m) add("path", m[0]);
    }
    for (const m of line.matchAll(EMAIL)) {
      if (!NOT_TLD.has(m[2].toLowerCase()) && !SAFE_EMAIL.test(m[0])) add("email", m[0]);
    }
    for (const re of nameRes) {
      const m = re.exec(line);
      if (m) add("name", m[0]);
    }
  });
  return findings;
}

// `.sanitize-allow`: one literal per line that is meant to be public (the
// repo's own owner, say). Lines starting with # are comments.
function readAllow(cwd: string): string[] {
  const path = join(cwd, ".sanitize-allow");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
}

// UTF-16 text (some Windows tools write it) holds NUL bytes but isn't binary.
function decode(buf: Buffer): string | undefined {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString("utf16le");
  return buf.includes(0) ? undefined : buf.toString("utf8");
}

// `--history`: every line any commit on any branch ever added. A secret that
// was committed and later deleted still goes public with the history.
// Findings are reported as <commit>:<file>, with the line in that commit's diff.
export function sanitizeHistory(cwd: string, config: Table): Finding[] {
  const out = spawnSync("git", ["log", "--all", "-p", "--no-color", "--no-ext-diff", "--format=commit %h"], { cwd, encoding: "utf8", maxBuffer: 1 << 30 });
  if (out.status !== 0) throw new Error(`git log failed: ${out.stderr?.trim()}`);
  const names = ownerNames(cwd, config);
  const allowed = readAllow(cwd);
  const seen = new Set<string>();
  const findings: Finding[] = [];
  let commit = "";
  let file = "";
  for (const line of out.stdout.split("\n")) {
    if (line.startsWith("commit ")) commit = line.slice(7);
    else if (line.startsWith("+++ ")) file = line.replace(/^\+\+\+ (b\/)?/, "");
    else if (line.startsWith("+") && file !== ".sanitize-allow") {
      for (const f of scanText(`${commit}:${file}`, line.slice(1), names, allowed)) {
        // The same leak in many commits is one finding (the newest commit is listed first).
        const key = `${file}\0${f.kind}\0${f.match}`;
        if (!seen.has(key)) findings.push(f), seen.add(key);
      }
    }
  }
  return findings;
}

export function sanitize(cwd: string, config: Table): Finding[] {
  const names = ownerNames(cwd, config);
  const allowed = readAllow(cwd);
  const findings: Finding[] = [];
  for (const file of publishedFiles(cwd)) {
    if (file === ".sanitize-allow") continue;
    const path = join(cwd, file);
    if (!existsSync(path) || !statSync(path).isFile()) continue;
    const text = decode(readFileSync(path));
    if (text !== undefined) findings.push(...scanText(file, text, names, allowed));
  }
  return findings;
}
