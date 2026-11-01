# How it works and why

The reasoning behind the workflow's shape. For what each part does, see the [feature reference](../reference/features.md).

## Rules the agent can't forget

Instructions in `CLAUDE.md` are advice: a long session can drift from them. So anything that must hold is enforced by a hook or a test rather than a sentence. The `guard` hook checks each command and edit before it runs, the `gate` hook stops the agent from declaring a task done while checks are missing, and the settings fitness test fails if any setting is read by nothing. The instruction files stay short (`saw lint-context` caps them), because long context files cost tokens on every turn and tend to lower success rates.

## Effort scales with risk

A typo and a payment flow shouldn't go through the same process. The router picks a tier, and the tier decides the ceremony: a trivial change runs the tests, a critical one adds a threat model and a rollback plan. Grilling (questions before code) runs only where a wrong assumption is expensive. This keeps the common case cheap and puts the extra tokens where mistakes cost most.

## Evidence over claims

The agent records what it ran (`saw run`) and what it judged (`saw task record`), and the result is labelled from that record, never from the agent's own summary. The same records drive improvement: `saw retro` proposes a fix only for a check that keeps failing across tasks, and `saw eval` compares the eval suite before and after a change, so the workflow changes when the numbers say so.

## Independent review

A reviewer that saw the builder's reasoning tends to share its blind spots. Code and security reviews run as separate agents, and the review session is a fresh, read-only session that sees only the repo, the plan and the diff.

## Layered settings, guarded from the repo

Teams need shared settings, and people need their own. Four layers (defaults, `~/.saw/config.toml`, the committed `workflow.toml`, the gitignored `workflow.local.toml`) give both. Because cloning a repo shouldn't hand it control of your machine, the committed layer can only tighten the guardrails, and the agent needs your approval to change them.

## Composed, not reinvented

Where a good skill already exists, the workflow pins it and builds on it (grilling and tdd from mattpocock-skills, unslop for UI polish, brag for launch videos) instead of copying it. Each third-party skill is pinned to a reviewed commit, because a skill can run commands.

## Autonomy you can bound

`saw autopilot` exists for work that's planned and approved but tedious to drive by hand. Everything about it is bounded: only owner-approved items, a budget per item and in total, a stop after repeated failures, and every item ends on its own branch for review. It never merges, so a human always decides what ships.
