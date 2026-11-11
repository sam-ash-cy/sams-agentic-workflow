// Preloaded by `bun run test` (package.json): point the global layer at an empty dir, so the
// tests (and every saw they spawn) never read the real ~/.saw/config.toml.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SAW_HOME = mkdtempSync(join(tmpdir(), "saw-home-"));
// Run from an empty directory, not this repo: guard calls that default to process.cwd()
// (the no-task verify guard hashes the working tree) must not read local edits; that
// made the suite slow and its results depend on the checkout. Verify-guard tests pass
// their own repo as cwd.
process.chdir(mkdtempSync(join(tmpdir(), "saw-cwd-")));
// In-process hook commands (run(["guard"]), run(["gate"])...) never read the runner's
// stdin: an open terminal or pipe there blocks forever. Spawned saws still get theirs.
const { useStdin } = await import("../src/main");
useStdin("");
