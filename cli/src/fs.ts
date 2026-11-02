// Read-or-undefined in one call, so there's no exists-then-read gap for the
// file to change in (CodeQL js/file-system-race).

import { readFileSync } from "node:fs";

export function readIfExists(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}
