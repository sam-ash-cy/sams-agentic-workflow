# Phase 11: independent audit session per unit of work

Stacks on Phase 10 (`feat/phase-10-sessions`, not merged yet): it reuses the unit a session opened with `saw task start --unit`.

## Goal
When a phase, stage or feature is done (checks run, before the PR), a separate, fresh, read-only session that hasn't seen the builder's reasoning grills the work against its plan and audits it for holes. Its findings come back to the building session as a list to fix or answer, and land in metrics for the retro.

## Already there
- `[sessions]` and `saw session-hook` (Phase 10): the open unit per session in `.saw/sessions/<id>.json`.
- `autonomy.actions.spawn_sessions` in `saw guard`; the `[audit]` catalogue (whole-project auditor skills on critical/hardening/audit). This phase is per unit, not per project, and runs as its own session rather than skills in the builder's context.

## Built
- **`[review_session]` settings**:
  - `enabled = false`: the switch. Off, nothing below happens.
  - `when = ["feature", "phase", "stage"]`: unit kinds that get a review session.
  - `mode = "grill" | "audit" | "both"` (default `both`): grill = against the plan and acceptance criteria; audit = holes (missing features, settings that do nothing, untested paths, gaps against the blueprint).
  - `budget_by_tier = { trivial = 0, standard = 40000, complex = 80000, critical = 150000 }`: the token budget the brief gives the reviewer. `0` skips the tier, so trivial tasks skip it by default.
- **`saw review-session brief`**: prints the reviewer's brief for the open unit (unit, tier, mode, budget, plan file `docs/plans/<unit-id>.md` if there is one, `docs/BLUEPRINT.md`, the diff against the base branch, read-only, output format). Use it to open the sub-session yourself (an Agent or app session).
- **`saw review-session run [--dry-run]`**: starts that sub-session as `claude -p` with edits disallowed, saves its report to `.saw/reviews/<unit-id>.md` and records it. `saw guard` counts it as `spawn_sessions` (ask by default); it isn't blocked by `features.parallel_sessions`, since it runs one after the other.
- **`saw review-session record <file>`**: records a report produced elsewhere. Findings are lines starting `- [`; each record goes to `.saw/reviews.jsonl`, prints the list for the builder to fix or answer, and `saw task end` adds `review_session` findings to the task's metric.
- **Hook**: `saw session-hook` PreToolUse on `gh pr create`: with the switch on, a unit of a `when` kind open, and the tier's budget above 0, the PR is denied until a review for that unit is recorded.
- **`saw task start`** lists the step when it applies.
- **Evals** `review-planted-gap`, `review-off`, `review-trivial-skip`.

## Out of scope
- Enforcing the token budget inside the sub-session: `claude -p` has no token cap flag; the budget is in the brief and the recorded report.
- Making the builder fix every finding: it must fix or answer each; the gate is that a review exists.

## Not verified
- `saw review-session run` is tested with `--dry-run` only; a real `claude -p` run is paid and not in `bun test`.
- The evals need `claude plugin eval`.
