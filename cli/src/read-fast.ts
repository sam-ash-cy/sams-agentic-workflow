// Hook fast path for the guard: Read, Grep and Glob calls that touch nothing saw
// guards (the review key, anything under .saw, secrets files) exit before main.ts
// and its imports load. Anything else, or anything unsure, takes the full guard.
const FAST_TOOLS = ["Read", "Grep", "Glob"];
const GUARDED = /\.saw|review.key|\.env/i;

export function fastReadAllowed(payload: string): boolean {
  let input: { tool_name?: unknown; tool_input?: unknown };
  try {
    input = JSON.parse(payload);
  } catch {
    return false;
  }
  if (!input || typeof input.tool_name !== "string" || !FAST_TOOLS.includes(input.tool_name)) return false;
  const t = input.tool_input;
  if (typeof t !== "object" || !t) return false;
  // Any value counts, strings or not: the full guard decides when something looks guarded.
  return !GUARDED.test(JSON.stringify(t));
}
