---
name: retro-promote
description: Use after a task ends with failed checks, when the user asks for a retro, or when `saw retro` lists open proposals. Turns a repeated failure into one enforceable fix with an eval case, and gets it approved before it lands.
---

## 1. Find what repeats
Run `saw retro`. It writes a proposal in `docs/proposals/` for each check that failed in `retro.repeat_threshold` or more tasks (default 2). A failure seen once is not a pattern: leave it.

## 2. Root cause (one per proposal)
Read the failing logs in `.saw/logs/` and pick one:
- **missing context**: the agent didn't know a fact that was written down somewhere
- **poor instruction**: a skill, playbook or AGENTS.md line was unclear or wrong
- **missing tool**: no command or check exists for this
- **missing test**: nothing caught it before review
- **reasoning error**: the facts were there and the agent got it wrong

Write it under **Root cause**, citing the log lines.

## 3. Fix, most enforceable first
1. test or lint rule, with an error message that says how to fix it
2. hook
3. skill or playbook edit
4. one AGENTS.md line (last resort: it costs tokens in every session)

## 4. Prove it
1. Add `evals/regress-<check>/` that reproduces the failure (see `evals/README.md`).
2. `saw eval --save-baseline` before the fix, `saw eval` after. The fix lands only if no case gets worse.
3. Record both results under **Eval case**.

## 5. Approval
Under `autonomy.actions.self_improve = "propose"` (the default), show the user the proposal and wait for a yes. Never edit global files (`edit_global`) or commit without their go-ahead. When it merges, set `status: promoted` and `promoted: <date>`; the dashboard's promotion_effect panel then tracks whether the failure stopped. A rejected fix gets `status: rejected` and a reason.
