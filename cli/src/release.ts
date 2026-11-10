// Versioned releases: one version (package.json) mirrored into every manifest,
// a changelog from Conventional Commits, and an annotated tag. Never pushes.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Bump = "patch" | "minor" | "major";
export type Commit = { hash: string; subject: string; body: string };

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+)\.(\d+))?$/;
const SELF = "sams-agentic-workflow";

type Parsed = { major: number; minor: number; patch: number; pre?: { id: string; n: number } };

export function parseVersion(v: string): Parsed {
  const m = SEMVER.exec(v.replace(/^v/, ""));
  if (!m) throw new Error(`not a version: ${v}`);
  return { major: +m[1]!, minor: +m[2]!, patch: +m[3]!, pre: m[4] ? { id: m[4], n: +m[5]! } : undefined };
}

function format(p: Parsed): string {
  return `${p.major}.${p.minor}.${p.patch}${p.pre ? `-${p.pre.id}.${p.pre.n}` : ""}`;
}

function base(p: Parsed, kind: Bump): Parsed {
  if (kind === "major") return { major: p.major + 1, minor: 0, patch: 0 };
  if (kind === "minor") return { major: p.major, minor: p.minor + 1, patch: 0 };
  return { major: p.major, minor: p.minor, patch: p.patch + 1 };
}

/**
 * The next version. From a pre-release, `pre` counts up (beta.0 -> beta.1, or
 * restarts at 0 for a new id), and no `pre` finalises it (0.2.0-beta.1 -> 0.2.0).
 */
export function bump(current: string, kind: Bump, pre?: string): string {
  const p = parseVersion(current);
  if (p.pre) {
    const release = { major: p.major, minor: p.minor, patch: p.patch };
    if (!pre) return format(release);
    return format({ ...release, pre: { id: pre, n: pre === p.pre.id ? p.pre.n + 1 : 0 } });
  }
  const next = base(p, kind);
  return format(pre ? { ...next, pre: { id: pre, n: 0 } } : next);
}

const CC = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;

function classify(c: Commit): { type: string; scope: string; breaking: boolean; text: string } | undefined {
  const m = CC.exec(c.subject);
  if (!m) return undefined;
  return { type: m[1]!.toLowerCase(), scope: m[2] ?? "", breaking: !!m[3] || /^BREAKING[ -]CHANGE:/m.test(c.body), text: m[4]! };
}

/** Before 1.0 a breaking change is a minor bump; from 1.0 it is major. */
export function suggestBump(current: string, commits: Commit[]): Bump {
  const parsed = commits.map(classify).filter((c) => c !== undefined);
  if (parsed.some((c) => c.breaking)) return parseVersion(current).major === 0 ? "minor" : "major";
  if (parsed.some((c) => c.type === "feat")) return "minor";
  return "patch";
}

export function changelog(commits: Commit[], version: string, date: string, repoUrl?: string, all = false): string {
  const groups: Record<string, string[]> = { "Breaking changes": [], Features: [], Fixes: [], Other: [] };
  for (const c of commits) {
    const k = classify(c);
    // Non-conventional subjects and earlier release commits are left out.
    if (!k || (k.type === "chore" && k.scope === "release")) continue;
    const text = repoUrl ? k.text.replace(/\(#(\d+)\)/g, `([#$1](${repoUrl}/pull/$1))`) : k.text;
    if (k.breaking) groups["Breaking changes"]!.push(text);
    else if (k.type === "feat") groups.Features!.push(text);
    else if (k.type === "fix" || k.type === "perf") groups.Fixes!.push(text);
    else if (all) groups.Other!.push(`${k.type}: ${text}`);
  }
  const out = [`## [${version}] - ${date}`, ""];
  for (const [title, items] of Object.entries(groups)) {
    if (items.length) out.push(`### ${title}`, "", ...items.map((i) => `- ${i}`), "");
  }
  if (out.length === 2) out.push("No user-facing changes.", "");
  return out.join("\n");
}

const HEADER = "# Changelog\n\nAll notable changes to this project. Versions follow [Semantic Versioning](https://semver.org); entries are generated from Conventional Commits by `saw release`.\n\n";

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Splits a changelog into its `## [version]` sections. */
function sections(text: string): { version: string; body: string }[] {
  const parts = text.split(/^(?=## \[)/m).filter((p) => p.startsWith("## ["));
  return parts.map((p) => ({ version: /^## \[([^\]]+)\]/.exec(p)![1]!, body: p.trimEnd() }));
}

/** New section first; finalising a version drops its pre-release sections. */
export function prependChangelog(existing: string | undefined, section: string, version: string): string {
  let kept = sections(existing ?? "");
  if (!version.includes("-")) kept = kept.filter((s) => !s.version.startsWith(`${version}-`));
  return [HEADER + section.trimEnd(), ...kept.map((s) => s.body)].join("\n\n") + "\n";
}

/** The body of one version's section, for release notes. */
export function notesFor(text: string, version: string): string | undefined {
  const want = version.replace(/^v/, "");
  const s = sections(text).find((x) => x.version === want);
  return s ? s.body.replace(new RegExp(`^## \\[${escape(want)}\\][^\\n]*\\n`), "").trim() + "\n" : undefined;
}

/** Every manifest that carries the version, relative to root. */
export function versionFiles(root: string): string[] {
  const files = ["package.json", ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json"];
  const mods = join(root, "mods");
  if (existsSync(mods)) {
    for (const d of readdirSync(mods, { withFileTypes: true })) {
      const f = `mods/${d.name}/.claude-plugin/plugin.json`;
      if (d.isDirectory() && existsSync(join(root, f))) files.push(f);
    }
  }
  return files.filter((f) => existsSync(join(root, f)));
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function selfEntry(json: Record<string, unknown>): { name: string; version?: string } | undefined {
  return (json.plugins as { name: string; version?: string }[] | undefined)?.find((p) => p.name === SELF);
}

export function currentVersion(root: string): string {
  return readJson(join(root, "package.json")).version as string;
}

/** Files whose version differs from package.json. */
export function checkVersions(root: string): string[] {
  if (!existsSync(join(root, "package.json"))) return [];
  const problems: string[] = [];
  let want: string;
  try {
    want = currentVersion(root);
  } catch (e) {
    return [`package.json: ${(e as Error).message}`];
  }
  for (const f of versionFiles(root)) {
    let json: Record<string, unknown>;
    try {
      json = readJson(join(root, f));
    } catch (e) {
      problems.push(`${f}: ${(e as Error).message}`);
      continue;
    }
    const got = f.endsWith("marketplace.json") ? selfEntry(json)?.version : (json.version as string | undefined);
    if (got !== want) problems.push(`${f} has version ${got ?? "(none)"}, package.json has ${want}`);
  }
  return problems;
}

/** Writes the version into every manifest, in place where the field exists so layout survives. */
export function writeVersions(root: string, version: string): string[] {
  const files = versionFiles(root);
  for (const f of files) {
    const path = join(root, f);
    const text = readFileSync(path, "utf8");
    const json = JSON.parse(text) as Record<string, unknown>;
    if (f.endsWith("marketplace.json")) {
      const self = selfEntry(json);
      if (!self) continue;
      self.version = version;
      writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
    } else if (typeof json.version === "string") {
      writeFileSync(path, text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`));
    } else {
      writeFileSync(path, JSON.stringify({ ...json, version }, null, 2) + "\n");
    }
  }
  return files;
}

// --- git -------------------------------------------------------------------

function git(root: string, args: string[]): { ok: boolean; out: string } {
  const p = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return { ok: p.exitCode === 0, out: (p.exitCode === 0 ? p.stdout : p.stderr).toString().trim() };
}

/** The latest version tag; `final` skips pre-releases, so a final release covers its betas too. */
export function lastTag(root: string, final = false): string | undefined {
  const r = git(root, ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", ...(final ? ["--exclude", "v*-*"] : [])]);
  return r.ok ? r.out : undefined;
}

export function commitsSince(root: string, tag?: string): Commit[] {
  const r = git(root, ["log", "--format=%H%x1f%s%x1f%b%x1e", ...(tag ? [`${tag}..HEAD`] : [])]);
  if (!r.ok || !r.out) return [];
  return r.out.split("\x1e").map((s) => s.trim()).filter(Boolean).map((s) => {
    const [hash, subject, body] = s.split("\x1f");
    return { hash: hash!, subject: subject ?? "", body: body ?? "" };
  });
}

function repoUrl(root: string): string | undefined {
  const r = git(root, ["remote", "get-url", "origin"]);
  const m = r.ok ? /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(r.out) : null;
  return m ? `https://github.com/${m[1]}` : undefined;
}

export type ReleaseOptions = { bump?: string; pre?: string; dryRun?: boolean; all?: boolean; allowBranch?: boolean; date?: string };
export type ReleaseResult = { version: string; tag: string; notes: string; files: string[]; problems: string[] };

/** The next version: explicit, or bumped, or (first release, nothing asked) the current one. */
export function nextVersion(current: string, commits: Commit[], hasTag: boolean, b?: string, pre?: string): string {
  if (b && /^v?\d/.test(b)) return format(parseVersion(b));
  if (b && b !== "patch" && b !== "minor" && b !== "major") throw new Error(`bump must be patch, minor, major or a version, not "${b}"`);
  if (!hasTag && !b && !pre) return current;
  return bump(current, (b as Bump | undefined) ?? suggestBump(current, commits), pre);
}

/** Branches that may merge into `main`: `release/vX.Y.Z` and `hotfix/*`. */
export function mergesIntoMain(head: string): boolean {
  return /^release\/v\d+\.\d+\.\d+$/.test(head) || /^hotfix\/[\w.-]+$/.test(head);
}

/**
 * Releases are cut on `release/vX.Y.Z` (or a `hotfix/*` branch), then merged into
 * `main` (tagged there afterwards with tagRelease), so `main` only ever moves to released code. A release
 * branch must name the version being made (`release/v1.2.0` also takes `1.2.0-beta.N`).
 */
export function branchProblems(branch: string, version: string, allowBranch = false): string[] {
  if (allowBranch) return [];
  const base = version.replace(/-.*/, "");
  if (!mergesIntoMain(branch)) return [`on branch ${branch || "(detached)"}, not release/v${base} or hotfix/* (pass --allow-branch to override)`];
  if (branch.startsWith("release/") && branch !== `release/v${base}`) return [`branch ${branch} does not match this release, v${version}`];
  return [];
}

/** Bumps the manifests, writes CHANGELOG.md and commits. Tagging happens on main, after the merge (tagRelease). Never pushes. */
export function release(root: string, opts: ReleaseOptions): ReleaseResult {
  const problems: string[] = [];
  const since = lastTag(root);
  const version = nextVersion(currentVersion(root), commitsSince(root, since), !!since, opts.bump, opts.pre);
  // A final release folds its betas' sections away, so its notes start from the last final tag.
  const commits = commitsSince(root, version.includes("-") ? since : lastTag(root, true));
  const tag = `v${version}`;
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const section = changelog(commits, version, date, repoUrl(root), opts.all);
  const notes = section.split("\n").slice(2).join("\n").trim() + "\n";
  const files = [...versionFiles(root), "CHANGELOG.md"];

  if (git(root, ["rev-parse", "-q", "--verify", `refs/tags/${tag}`]).ok) problems.push(`tag ${tag} already exists`);
  if (git(root, ["status", "--porcelain"]).out) problems.push("working tree is not clean");
  const branch = git(root, ["branch", "--show-current"]).out;
  problems.push(...branchProblems(branch, version, opts.allowBranch));
  problems.push(...checkVersions(root));
  if (opts.dryRun || problems.length) return { version, tag, notes, files, problems };

  writeVersions(root, version);
  const path = join(root, "CHANGELOG.md");
  let existing: string | undefined;
  try {
    existing = readFileSync(path, "utf8");
  } catch {
    existing = undefined; // no CHANGELOG.md yet
  }
  writeFileSync(path, prependChangelog(existing, section, version));
  for (const step of [["add", "--", ...files], ["commit", "-q", "-m", `chore(release): ${tag}`]]) {
    const r = git(root, step);
    if (!r.ok) {
      problems.push(`git ${step[0]} failed: ${r.out}`);
      break;
    }
  }
  return { version, tag, notes, files, problems };
}

/**
 * After the release branch is merged: tags `main` with the version in the
 * manifests, using its CHANGELOG.md section as the message. Never pushes.
 */
export function tagRelease(root: string, opts: { dryRun?: boolean; allowBranch?: boolean } = {}): { tag: string; problems: string[] } {
  const tag = `v${currentVersion(root)}`;
  const problems = checkVersions(root);
  const branch = git(root, ["branch", "--show-current"]).out;
  if (branch !== "main" && !opts.allowBranch) problems.push(`on branch ${branch || "(detached)"}, not main: merge the release branch first (pass --allow-branch to override)`);
  if (git(root, ["status", "--porcelain"]).out) problems.push("working tree is not clean");
  if (git(root, ["rev-parse", "-q", "--verify", `refs/tags/${tag}`]).ok) problems.push(`tag ${tag} already exists`);
  let changelogText = "";
  try {
    changelogText = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  } catch {
    changelogText = ""; // reported below
  }
  const notes = notesFor(changelogText, tag);
  if (!notes) problems.push(`no CHANGELOG.md section for ${tag}: run saw release on the release branch first`);
  if (opts.dryRun || problems.length) return { tag, problems };
  const r = git(root, ["tag", "-a", "--cleanup=verbatim", tag, "-m", `${tag}\n\n${notes}`]);
  if (!r.ok) problems.push(`git tag failed: ${r.out}`);
  return { tag, problems };
}

/** For CI: the pushed tag must match every manifest. */
export function verifyTag(root: string, tag: string): string[] {
  const want = currentVersion(root);
  const problems = checkVersions(root);
  if (tag.replace(/^v/, "") !== want) problems.unshift(`tag ${tag} does not match package.json version ${want}`);
  return problems;
}
