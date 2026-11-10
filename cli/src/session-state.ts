// Where a session's state file lives; shared by sessions.ts and task.ts (which sessions.ts imports).
import { join } from "node:path";

// One file per session, so sessions sharing a checkout don't overwrite each other.
export const statePath = (cwd: string, sessionId: string): string =>
  join(cwd, ".saw", "sessions", `${sessionId.replace(/[^\w-]/g, "_")}.json`);
