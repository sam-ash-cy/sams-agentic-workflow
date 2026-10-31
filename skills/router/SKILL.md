---
name: router
description: Use at the start of every coding task (feature, bug, refactor, config change, design, investigation). Classifies the task into a tier and playbook, says both in one line, then follows that path. The user can override with "tier=<t>" or "playbook=<p>".
---

## 1. Classify (one line, then go)
Say: `Tier: <tier> · Playbook: <playbook> · <reason in ≤10 words>`. If the user overrides it, use theirs.

| Tier | Signals |
|---|---|
| trivial | typo, copy, one-line config, rename in one file; no behaviour change |
| standard | a normal feature or bug fix inside existing structure |
| complex | new subsystem, new integration, cross-cutting change, unclear design |
| critical | auth, permissions, secrets, payments, data migration, infra, production |

When unsure between two tiers, pick the higher. Then run `saw task start --tier <tier> --playbook <playbook>`.

Playbooks (read only the one you picked, from `playbooks/<name>.md`): foundation · design · feature · integration · debug · spike · hardening · audit.

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
- Judgement checks (code_review, security_review, threat_model): do the review, then `saw task record <check> pass|fail --note "<one line>"`.
- A check counts only if it ran in this task. Never report one from memory.

## 4. Report (end of task)
Run `saw task status` and use its label:
- **Verified**: every required check passed in this task.
- **Partially verified**: some passed, some did not run (say which and why).
- **Not verified**: none ran (say why, e.g. no Docker here).
- **Blocked**: a check failed and is not fixed.
Then `saw task end`. A Stop hook blocks "done" while required checks are missing or failing.

## 5. Suggest
After the report, suggest at most two follow-up features or improvements, each one line, and ask which (if any) the user wants.
