# Phase 10: session per unit of work

## Goal
One session does one phase, stage or feature. When a session that has already finished a unit (committed, or opened its PR) starts the next one, a hook steps in: a warning, or a block until a handoff is written and a fresh session takes over.

## Already there (audit fixes, round 3, PR #11)
- `autonomy.actions.spawn_sessions` (ask): `saw guard` applies it to `claude -p` / `--print` session starts.
- `features.parallel_sessions` (off: guard denies session starts) and `features.worktrees` (off: guard denies `git worktree add`); on, `saw task start` adds their steps on complex and critical.
- The context-% handoff (`context.handoff_at`, cli/src/context.ts) and the runner's one-item-one-session rule (ADR 0014). This phase adds the third trigger: a unit boundary, not a full context.

## Built
- **`[sessions]` settings** (same layers as everything else):
  - `new_per = ["phase", "stage", "feature"]` (default all three): unit kinds that need a fresh session. `[]` turns the hook off.
  - `mode = "soft" | "hard"` (default `soft`).
- **`saw task start --unit <phase|stage|feature> --unit-id <name>`**: the router passes these when a task begins a unit (e.g. `--unit phase --unit-id phase-10`). A follow-up fix leaves them out, or repeats the same `--unit-id`.
- **`saw session-hook`** (PreToolUse and PostToolUse on Bash), with state in `.saw/sessions/<session_id>.json` (a new session starts clean):
  - PostToolUse: a successful `saw task start --unit ...` records the current unit; a successful `git commit` or `gh pr create` (not `--dry-run`, not inside an `echo`) marks the open unit finished; a commit with no unit open finishes nothing.
  - PreToolUse: `saw task start --unit <kind> --unit-id <id>` in a session that has finished a unit with a different id, where `<kind>` is in `new_per`, steps in. `soft` allows it with a warning; `hard` denies it, asking for a handoff (prompts/handoff.md, `docs/plans/handoff-*.md`) and a fresh session, started by the user or with `claude -p` (which `saw guard` still gates through `spawn_sessions` and `parallel_sessions`). Once a handoff is written after the finish, the reason says so and only asks for the fresh session.
- **Evals** `sessions-second-phase` (a second phase in the same session gets the warning or block) and `sessions-follow-up` (a same-phase fix doesn't).

## Out of scope
- Starting the fresh session automatically. Outward-facing; the user or `spawn_sessions` decides.
- Guessing unit boundaries from the prompt text. The router names the unit; the hook only enforces it.

## Not verified
- PostToolUse's `tool_response` shape for Bash isn't a documented API; a commit counts as finished unless the response reports a non-zero exit code or an interrupt.
- The evals need `claude plugin eval` to run; they are not run in `bun test`.
