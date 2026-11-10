import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { branchProblems, bump, changelog, mergesIntoMain, checkVersions, nextVersion, notesFor, prependChangelog, release, tagRelease, suggestBump, verifyTag, writeVersions, type Commit } from "../src/release";

const c = (subject: string, body = ""): Commit => ({ hash: "x", subject, body });

test("bump: patch, minor, major, pre-release and finalise", () => {
  expect(bump("0.1.0", "patch")).toBe("0.1.1");
  expect(bump("0.1.3", "minor")).toBe("0.2.0");
  expect(bump("1.2.3", "major")).toBe("2.0.0");
  expect(bump("0.1.0", "minor", "beta")).toBe("0.2.0-beta.0");
  expect(bump("0.2.0-beta.0", "minor", "beta")).toBe("0.2.0-beta.1");
  expect(bump("0.2.0-beta.1", "minor", "rc")).toBe("0.2.0-rc.0");
  expect(bump("0.2.0-beta.1", "minor")).toBe("0.2.0");
  expect(() => bump("one", "patch")).toThrow();
});

test("suggestBump: breaking is minor before 1.0, major after", () => {
  expect(suggestBump("0.3.0", [c("fix: a")])).toBe("patch");
  expect(suggestBump("0.3.0", [c("fix: a"), c("feat(cli): b")])).toBe("minor");
  expect(suggestBump("0.3.0", [c("feat!: drop x")])).toBe("minor");
  expect(suggestBump("1.0.0", [c("fix: y", "BREAKING CHANGE: z")])).toBe("major");
});

test("nextVersion: first release keeps the current version; explicit wins", () => {
  expect(nextVersion("0.1.0", [c("feat: a")], false)).toBe("0.1.0");
  expect(nextVersion("0.1.0", [c("feat: a")], true)).toBe("0.2.0");
  expect(nextVersion("0.1.0", [], true, "0.5.0")).toBe("0.5.0");
  expect(() => nextVersion("0.1.0", [], true, "huge")).toThrow();
});

test("changelog: groups, links PRs, hides chores unless --all", () => {
  const commits = [c("feat: wizard (#34)"), c("fix(ci): race (#33)"), c("chore: tidy"), c("feat!: new config"), c("Update README"), c("chore(release): v0.1.0")];
  const text = changelog(commits, "0.2.0", "2026-11-09", "https://github.com/o/r");
  expect(text).toStartWith("## [0.2.0] - 2026-11-09");
  expect(text).toContain("### Breaking changes\n\n- new config");
  expect(text).toContain("- wizard ([#34](https://github.com/o/r/pull/34))");
  expect(text).toContain("### Fixes");
  expect(text).not.toContain("tidy");
  expect(text).not.toContain("README");
  expect(changelog(commits, "0.2.0", "d", undefined, true)).toContain("- chore: tidy");
  expect(changelog([c("chore: x")], "0.2.1", "d")).toContain("No user-facing changes.");
});

test("prependChangelog folds betas into the final release; notesFor extracts one section", () => {
  let log = prependChangelog(undefined, changelog([c("feat: a")], "0.2.0-beta.0", "d"), "0.2.0-beta.0");
  log = prependChangelog(log, changelog([c("fix: b")], "0.2.0-beta.1", "d"), "0.2.0-beta.1");
  expect(log.match(/^## \[/gm)?.length).toBe(2);
  const final = prependChangelog(log, changelog([c("feat: a"), c("fix: b")], "0.2.0", "d"), "0.2.0");
  expect(final).toStartWith("# Changelog");
  expect(final).not.toContain("beta");
  expect(notesFor(final, "v0.2.0")).toBe("### Features\n\n- a\n\n### Fixes\n\n- b\n");
  expect(notesFor(final, "9.9.9")).toBeUndefined();
});

function repo(withMod = true): string {
  const dir = mkdtempSync(join(tmpdir(), "saw-release-"));
  mkdirSync(join(dir, ".claude-plugin"));
  writeFileSync(join(dir, "package.json"), '{\n  "name": "x",\n  "version": "0.1.0",\n  "private": true\n}\n');
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "sams-agentic-workflow", version: "0.1.0" }, null, 2) + "\n");
  writeFileSync(join(dir, ".claude-plugin", "marketplace.json"), JSON.stringify({ plugins: [{ name: "sams-agentic-workflow", source: "./", version: "0.1.0" }, { name: "other", source: "./x" }] }, null, 2) + "\n");
  if (withMod) {
    mkdirSync(join(dir, "mods", "band", ".claude-plugin"), { recursive: true });
    writeFileSync(join(dir, "mods", "band", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "band", version: "0.1.0" }) + "\n");
  }
  return dir;
}

test("checkVersions and writeVersions keep every manifest in sync, mods included", () => {
  expect(checkVersions(repo(false))).toEqual([]);
  const dir = repo();
  expect(checkVersions(dir)).toEqual([]);
  writeFileSync(join(dir, "mods", "band", ".claude-plugin", "plugin.json"), '{"name":"band"}');
  expect(checkVersions(dir)[0]).toContain("mods/band/.claude-plugin/plugin.json has version (none)");
  writeVersions(dir, "0.3.0");
  expect(checkVersions(dir)).toEqual([]);
  expect(readFileSync(join(dir, "package.json"), "utf8")).toContain('"version": "0.3.0",\n  "private"');
  const market = JSON.parse(readFileSync(join(dir, ".claude-plugin", "marketplace.json"), "utf8"));
  expect(market.plugins[1].version).toBeUndefined();
  expect(verifyTag(dir, "v0.3.0")).toEqual([]);
  expect(verifyTag(dir, "v0.3.1")[0]).toContain("does not match");
});

// Throwaway identity and no signing, for the temp repo only.
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid", GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "commit.gpgsign", GIT_CONFIG_VALUE_0: "false", GIT_CONFIG_KEY_1: "tag.gpgsign", GIT_CONFIG_VALUE_1: "false" }; // saw-sanitize: allow (reserved .invalid test address)
const git = (cwd: string, ...args: string[]): string => Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, ...gitEnv } }).stdout.toString().trim();

test("release: dry run writes nothing; a real run commits and tags, and never pushes", () => {
  const saved = { ...process.env };
  Object.assign(process.env, gitEnv);
  try {
    const dir = repo();
    git(dir, "init", "-q", "-b", "release/v0.1.0");
    // CI runners have no global identity, and release() spawns git without gitEnv.
    git(dir, "config", "user.name", "t");
    git(dir, "config", "user.email", "t@example.invalid"); // saw-sanitize: allow (reserved .invalid test address)
    git(dir, "config", "commit.gpgsign", "false");
    git(dir, "config", "tag.gpgsign", "false");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "feat: first");

    const dry = release(dir, { dryRun: true, date: "2026-11-09" });
    expect(dry.problems).toEqual([]);
    expect(dry.version).toBe("0.1.0");
    expect(git(dir, "status", "--porcelain")).toBe("");
    expect(git(dir, "tag")).toBe("");

    expect(release(dir, { date: "2026-11-09" }).problems).toEqual([]);
    // release() commits but never tags; the tag goes on main after the merge.
    expect(git(dir, "tag")).toBe("");
    expect(tagRelease(dir).problems[0]).toContain("not main");
    expect(tagRelease(dir, { allowBranch: true, dryRun: true }).problems).toEqual([]);
    expect(tagRelease(dir, { allowBranch: true }).problems).toEqual([]);
    expect(git(dir, "tag")).toBe("v0.1.0");
    expect(git(dir, "cat-file", "-t", "v0.1.0")).toBe("tag");
    expect(readFileSync(join(dir, "CHANGELOG.md"), "utf8")).toContain("## [0.1.0] - 2026-11-09");
    expect(release(dir, { bump: "0.1.0" }).problems).toContain("tag v0.1.0 already exists");
    git(dir, "checkout", "-q", "-b", "release/v0.2.0");

    git(dir, "commit", "-q", "--allow-empty", "-m", "fix: second");
    const beta = release(dir, { bump: "minor", pre: "beta", date: "d" });
    expect(beta.problems).toEqual([]);
    expect(tagRelease(dir, { allowBranch: true }).problems).toEqual([]);
    expect(beta.version).toBe("0.2.0-beta.0");
    expect(checkVersions(dir)).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, "mods", "band", ".claude-plugin", "plugin.json"), "utf8")).version).toBe("0.2.0-beta.0");
    expect(git(dir, "log", "-1", "--format=%s")).toBe("chore(release): v0.2.0-beta.0");
    expect(git(dir, "remote")).toBe("");

    // Annotated tag keeps the "###" headings; finalising keeps the betas' changes.
    expect(git(dir, "tag", "-l", "--format=%(contents)", "v0.2.0-beta.0")).toContain("### Fixes");
    git(dir, "commit", "-q", "--allow-empty", "-m", "feat: third");
    const final = release(dir, { bump: "v0.2.0", date: "d" });
    expect(final.problems).toEqual([]);
    expect(tagRelease(dir, { allowBranch: true }).problems).toEqual([]);
    expect(tagRelease(dir, { allowBranch: true }).problems).toContain("tag v0.2.0 already exists");
    expect(final.notes).toContain("- second");
    expect(final.notes).toContain("- third");
    expect(readFileSync(join(dir, "CHANGELOG.md"), "utf8")).not.toContain("beta");
    expect(release(dir, { dryRun: true, all: true }).notes).not.toContain("v0.2.0");

    git(dir, "checkout", "-q", "-b", "main");
    expect(release(dir, { dryRun: true }).problems[0]).toContain("not release/v");
    git(dir, "checkout", "-q", "-b", "feat/x");
    expect(release(dir, { dryRun: true }).problems[0]).toContain("not release/v");
    writeFileSync(join(dir, "dirty"), "x");
    expect(release(dir, { dryRun: true, allowBranch: true }).problems).toEqual(["working tree is not clean"]);
  } finally {
    for (const k of Object.keys(gitEnv)) if (!(k in saved)) delete process.env[k];
  }
}, 30_000); // many git spawns: slow on Windows runners

test("release: only release/vX.Y.Z and hotfix/* merge into main or cut a release", () => {
  for (const ok of ["release/v1.0.1", "hotfix/fix-icon", "hotfix/1.0.2"]) {
    expect(mergesIntoMain(ok)).toBe(true);
    expect(branchProblems(ok, "1.0.1")).toEqual([]);
  }
  for (const bad of ["main", "release", "feat/x", "release/1.0.1", "release/v1.0", "hotfix/", "hotfix/a b", ""]) {
    expect(mergesIntoMain(bad)).toBe(false);
    expect(branchProblems(bad, "1.0.1")).toHaveLength(1);
  }
  expect(branchProblems("release/v1.1.0", "1.1.0-beta.2")).toEqual([]);
  expect(branchProblems("release/v1.0.1", "1.0.2")[0]).toContain("does not match");
  expect(branchProblems("feat/x", "1.0.1", true)).toEqual([]);
});
