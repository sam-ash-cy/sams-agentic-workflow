---
name: router
description: Use at the start of every coding task (feature, bug, refactor, config change, design, investigation). Classifies the task into a tier and playbook, says both in one line, then follows that path. The user can override with "tier=<t>", "playbook=<p>", "tone=<t>" or "max_words=<n>".
---

## 1. Classify (one line, then go)
Say: `Tier: <tier> · Playbook: <playbook> · Style: <tone>, ≤<n> words · <reason in ≤10 words>`. If the user overrides it, use theirs. The style comes from `saw style` (or the `saw task start` output); a per-task override ("this task: tone=verbose") goes to `saw task start ... --tone <t> --max-words <n>`.

| Tier | Signals |
|---|---|
| trivial | typo, copy, one-line config, rename in one file; no behaviour change |
| standard | a normal feature or bug fix inside existing structure |
| complex | new subsystem, new integration, cross-cutting change, unclear design |
| critical | auth, permissions, secrets, payments, data migration, infra, production |

When unsure between two tiers, pick the higher. Then run `saw task start --tier <tier> --playbook <playbook>`. If the task begins a new phase, stage or feature, add `--unit <phase|stage|feature> --unit-id <name>` (e.g. `--unit phase --unit-id phase-10`); a follow-up fix within it leaves them out. If the session already finished a unit, `saw session-hook` warns or blocks ([sessions]): write the handoff (prompts/handoff.md) and suggest a fresh session. With `features.ecc` on, use `ecc:strategic-compact` to decide where to `/compact` and `ecc:context-budget` when context is tight from loaded skills, agents or MCP servers.

Playbooks (read only the one you picked, from `playbooks/<name>.md`): foundation · design · feature · integration · debug · spike · hardening · audit.

Tones: **normal** plain answer · **structured** bullets and tables, little prose · **detailed** reasoning and trade-offs · **verbose** full context and walkthroughs. The word cap counts prose only (code blocks, diffs and tool output don't count) and never drops the verification label.

## 2. Path by tier
- **trivial**: implement → run the checks for touched files → report. No plan, no grilling, no subagents.
- **standard**: write acceptance criteria → tdd → `saw run` each required check → code review + security review → report → PR.
- **complex**: grilling (always) → research → 2–3 options with trade-offs → independent review → ADR in `docs/decisions/` → wait for design approval → staged plan → the standard path per unit.
- **critical**: the complex path + threat model + rollback plan + the hardening playbook. Ask before any deploy.

**Phase in debugging when needed.** Switch to the debug playbook (`saw task start --tier <same> --playbook debug`, or keep the tier and follow playbooks/debug.md) as soon as any of these is true:
- the user reports a bug or failure
- the same check fails twice in this task
- a fix attempt didn't change the failure
Reproduce before changing code. If you're still stuck after that, follow prompts/stuck.md.

`saw config get verify.<tier>.run` lists the required checks. If an assumption turns out wrong, stop and re-plan; don't keep following a broken plan.

## 3. Evidence
- Mechanical checks: `saw run <check>` (it prints only failures and records the result).
- Judgement checks (code_review, security_review, threat_model, rollback_plan for critical): do the review, then `saw task record <check> pass|fail --note "<one line>"`.
- A check counts only if it ran in this task. Never report one from memory.

## 4. Report (end of task)
Run `saw task status` and use its label:
- **Verified**: every required check passed in this task.
- **Partially verified**: some passed, some did not run (say which and why).
- **Not verified**: none ran (say why, e.g. no Docker here).
- **Blocked**: a check failed and is not fixed.
For a PR description, paste `saw task report`. Then `saw task end`. A Stop hook blocks "done" while required checks are missing or failing. If a check failed during the task, run `saw retro`; any proposal it writes is handled with the retro-promote skill.

## 5. Suggest
After the report, suggest at most two follow-up features or improvements, each one line, and ask which (if any) the user wants.
