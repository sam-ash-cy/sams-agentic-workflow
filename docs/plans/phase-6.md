# Phase 6: metrics, dashboard and context nudges

## Built
- `saw task end` appends a metric per task to `.saw/metrics.jsonl`: tier, label, first pass, rework, failures by check, duration, and tokens (from `--tokens`, or best-effort from the transcript the Stop hook saw).
- `saw dashboard`: a static HTML page with the panels from `[dashboard].panels`, plus an optional Markdown note for the vault. Its paths must stay inside the project.
- Debug escalation: the gate points to the debug playbook when a check has failed twice and is still failing.
- `saw context` (a UserPromptSubmit hook):
  - It reads the current context size from the transcript and compares it to `context.window_tokens`.
  - At each `suggest_compact_at` share (default 50% and 70%), it suggests `/compact` at the next natural break.
  - At `handoff_at` (default 85%), it suggests a handoff and a fresh session, or a focused `/compact`.
  - Each threshold fires once per session. The user sees it (`systemMessage`) and so does Claude (`additionalContext`).
  - Turn it off with `features.compact_nudge = false`.

## Limits
- Hooks can't run `/compact` themselves. The nudge suggests it, and Claude Code's built-in auto-compaction still runs at the limit.
- The transcript format isn't a documented API. If it changes, the token tally and the nudge go quiet rather than fail.
- Set `window_tokens` to your model's context window (for example 1000000 for 1M-context models).
