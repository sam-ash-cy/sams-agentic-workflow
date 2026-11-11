// Hook entry: the plugin directory only accepts `bun --no-install "${CLAUDE_PLUGIN_ROOT}/<file>"`,
// with no arguments, so each saw hook command gets its own file.
// Read, Grep and Glob calls that no [safety] rule or signing-key check applies to exit
// here, before main.ts loads (see cli/src/read-fast.ts); everything else runs the full guard.
import { readFileSync } from "node:fs";
import { fastReadAllowed } from "../../cli/src/read-fast.ts";

const payload = process.argv.length > 2 || process.stdin.isTTY ? undefined : readFileSync(0, "utf8");
if (payload !== undefined && fastReadAllowed(payload)) process.exit(0);
const { run, SERVING, useStdin } = await import("../../cli/src/main.ts");
if (payload !== undefined) useStdin(payload);
const code = run(["guard", ...process.argv.slice(2)]);
if (code !== SERVING) process.exit(code);
