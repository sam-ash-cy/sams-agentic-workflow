# Plan 03 — Dispatcher and local runners (2.0.0-beta.3)

**Goal:** work on the board gets picked up and done by the right role, locally.
**Depends on:** 02. **Tier:** complex.

## Design

### Dispatcher

`saw org tick` is one pass, with no model call:

1. Sync the bus. Expire leases.
2. For each `ready` item, the stage's `owner` role is the candidate. For each role with unacked inbox messages, that role is a candidate.
3. Filter by: role budget left, team and business budget left, `org.max_concurrent`, role `max_concurrent`, runner available.
4. Order by priority, then age.
5. For each pick: claim the item, build an **assignment**, call the role's runner.

`saw org run` loops `tick` on an interval. `saw org stop` halts new dispatch and signals runners to finish at a safe point. `saw org status` shows what is running, waiting and blocked, and why.

### Assignment

What a runner receives, and all an agent needs to start cold:

```
role file · item JSON · inbox messages for this item · consumed artifacts (paths) ·
stage instructions from the process · allowed tools/paths/connectors · budget remaining ·
how to finish: `saw msg send --type handoff ...` or `saw board move ...`
```

Rendered by one template, `prompts/assignment.md`. Agents end a turn by posting to the bus, never by replying to each other directly.

### Runner interface

```ts
interface Runner { id: string; available(): Promise<boolean>;
  start(a: Assignment): Promise<Handle>; status(h: Handle): Promise<RunState>;
  stop(h: Handle): Promise<void>; collect(h: Handle): Promise<RunResult>; }
```

| Runner | Runs as | Best for |
|---|---|---|
| `subagent` | an Agent-tool subagent of the current Claude Code session | reviewers, researchers, short consults |
| `session` | headless `claude -p` in the repo | planners, product, docs |
| `worktree` | headless session in its own git worktree and branch | anything that writes code |

`subagent` cannot be launched by the CLI. The dispatcher emits a spawn instruction through the existing hook context, and `subagent.ts` matches the SubagentStop back to the item.

Every runner sets `SAW_ROLE` and `SAW_ITEM`, so plan 01's guard applies. `RunResult` records tokens, cost, exit reason and the messages posted.

### Reuse

`autopilot.ts` already runs one headless session per queue item with a PR. Refactor its launch code into the `session` and `worktree` runners; autopilot becomes a thin preset over the dispatcher. `adapters.ts` gives other harnesses (Codex, Cursor, Gemini CLI) a path to be runners later.

## Expected touch points

New: `cli/src/org/{dispatcher,assignment,runner,runner-subagent,runner-session,runner-worktree}.ts`, `prompts/assignment.md`.
Changed: `autopilot.ts`, `subagent.ts`, `sessions.ts`, `split.ts`, `branch.ts`, `model-guard.ts`, `metrics.ts`.

## Steps (failing test first for each)

1. Dispatcher selection as a pure function `(board, inboxes, config, now) → picks`.
2. Assignment builder and template.
3. Runner interface with a fake runner.
4. `worktree` runner extracted from autopilot. Autopilot's own tests must still pass.
5. `session` runner, then `subagent`.
6. Budget accounting per role, team, business. Hard stop at cap.
7. `saw org tick|run|stop|status`.
8. Config: `[org] max_concurrent, tick_seconds, max_retries`, `[runners.<id>]`, per-role `runner`, `max_concurrent`.

## Testing

- Unit: dispatcher selection as a table (budgets, caps, priorities, unavailable runner).
- Integration with the fake runner: a three-stage process to `done`; crash, retry and escalation paths; `stop` mid-run.
- Snapshot: the rendered assignment for a fixed role and item.
- Real runners: one smoke eval each, behind the `claude` CLI requirement, not in the default `bun run test`.

## Acceptance criteria

- With a fake runner, a three-stage process moves one item to `done` in three ticks.
- A role at its budget cap is skipped and the item shows `blocked: budget` in `saw org status`.
- `saw org stop` leaves no claimed item without a live handle after the lease expires.
- A runner crash releases the item and posts an `escalation` after `org.max_retries`.
- An agent run as role `qa-engineer` is denied a write outside its `paths.write`.
- Existing autopilot tests and evals pass.

## Open questions

- Worktrees isolate the checkout, not the database. Recommend a `runners.worktree.env` template with `{item}` substitution for per-worktree DB names and ports.
- Default `org.max_concurrent`: recommend 3, matching the human tracking ceiling in the global rules.
