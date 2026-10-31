# Phase 3: router, lifecycle and verify gate

## Goal
Each task is classified into a tier, follows its playbook, and cannot be reported "done" until the checks its tier requires have run in this task and their output was seen.

## In scope
- `skills/router`: classify (trivial / standard / complex / critical), pick a playbook, say both in one line, accept an override, then run `saw task start`.
- `playbooks/`: foundation, design, feature, integration, debug, spike, hardening. Each has entry criteria, extra gates, outputs and a definition of done.
- CLI:
  - `saw task start --tier <t> --playbook <p>` / `saw task status` / `saw task end`. The state lives in `.saw/task.json`.
  - `saw run <check>` runs the command in `[checks]`. Quiet output: only the tail of a failure (`output.max_lines`). The full log goes to `.saw/logs/`, and the result is appended to `.saw/checks.jsonl`.
  - `saw gate`, the Stop hook. It blocks ("decision": "block") while a mechanical check required by `verify.<tier>.run` has not passed since the task started. It allows when no task is open, when the feature is off, or when `stop_hook_active` is set (no loops).
  - `saw lint-context`: AGENTS.md ≤ 100 lines and CLAUDE.md ≤ 200 lines (both configurable).
- `hooks/hooks.json` wires `saw gate` to `Stop`.
- Report labels (Verified / Partially verified / Not verified / Blocked) are defined in the router skill. `saw task status` prints them from the check log.

## Out of scope (moved)
- **Token budget hook.** It needs per-task token counts, which arrive with metrics in Phase 6.
- **The eval runner.** Phase 7. The eval cases for this phase are written now in `evals/`.

## Tests
- Tier → required checks, with `extends`.
- The gate blocks with a missing or failed check and allows once it passes.
- The gate allows with no task, and with `stop_hook_active`.
- `saw run` records the result and truncates output.
- The context lint enforces its limits.
