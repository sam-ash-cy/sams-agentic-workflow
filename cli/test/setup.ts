// Preloaded by `bun run test` (package.json): point the global layer at an empty dir, so the
// tests (and every saw they spawn) never read the real ~/.saw/config.toml.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SAW_HOME = mkdtempSync(join(tmpdir(), "saw-home-"));
