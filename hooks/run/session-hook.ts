// Hook entry: the plugin directory only accepts `bun --no-install "${CLAUDE_PLUGIN_ROOT}/<file>"`,
// with no arguments, so each saw hook command gets its own file.
import { run, SERVING } from "../../cli/src/main.ts";

const code = run(["session-hook", ...process.argv.slice(2)]);
if (code !== SERVING) process.exit(code);
