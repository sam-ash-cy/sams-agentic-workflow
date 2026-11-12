# Plan 04 — Dev team and SDLC process (2.0.0-beta.4)

**Goal:** a goal typed in one line is carried from discovery to a draft PR by a team of roles, with a human at the gates.
**Depends on:** 03. **Tier:** complex.

## Roles (pack `engineering`)

| Role | Reports to | Runner | Produces | Notes |
|---|---|---|---|---|
| `product-owner` | human | session | brief, acceptance criteria, priority | grills the human; owns "what" |
| `architect` | product-owner | session | options, ADR draft, system design | wraps today's design path |
| `tech-lead` | architect | session | staged plan, unit breakdown, assignments | wraps `saw plan`; owns "how" |
| `implementer` | tech-lead | worktree | diff, tests | existing agent, now a role; one per unit, parallel |
| `qa-engineer` | tech-lead | session | test plan, test report | derives the plan from the implementation |
| `code-reviewer` | tech-lead | subagent | findings | existing agent |
| `security-reviewer` | tech-lead | subagent | findings, threat model | existing agent; mandatory on critical paths |
| `ui-verifier` | qa-engineer | subagent | screenshots, a11y report | existing agent |
| `tech-writer` | tech-lead | session | docs, user guide, changelog entry | wraps the docs step |
| `release-manager` | product-owner | session | release notes, version, PR | wraps `saw release`; never merges |
| `researcher` | any | subagent | cited summary | existing agent; on request |

The six files in `agents/` become role files with the same body, so they remain valid Claude Code agents.

## Process `sdlc`

```
discover ─▶ design ─▶ plan ─▶ build ─▶ verify ─▶ review ─▶ document ─▶ release ─▶ operate
 PO         architect  lead    impl     QA        reviewers  writer     rel-mgr    (plan 08)
 gate:human gate:human gate:   gate:    gate:     gate:      gate:      gate:human
 (brief)    (ADR)      none    checks   checks    reviews    living     (merge, tag)
                                                             docs
```

- Tiers select stages. trivial: build → verify. standard: plan → … → document. complex: all. critical: all, plus threat model and rollback plan at design.
- Rework is a first-class transition: `review → build` and `verify → build` carry the findings as a `review` message. After `sdlc.max_rework` loops the item escalates.
- **Disagreement protocol.** A role may post an `escalation` instead of accepting a handoff. It goes to the common manager in `reports_to`; if not settled in one exchange, to the human. Agents never override each other silently.
- **Standups.** `saw org standup` is a deterministic digest from the board and threads: done, in progress, blocked, waiting on human. No model call.

## Human touch

Default gates: brief, design, merge/release. Each is `gate: human` in the process file, so an owner can change any of them to `review:<role>` or `none` within what `[autonomy]` allows.

## Expected touch points

New: `templates/packs/engineering/{roles,teams,processes}/…`, `cli/src/org/standup.ts`.
Changed: `agents/*.md` (frontmatter only), `plan.ts`, `review-session.ts`, `docs.ts`, `release.ts`, `pr-body.ts`, `playbooks/*.md` (point at stages), `skills/router`.

## Steps (failing test first where code changes)

1. Convert the six agents to role files. Their existing behaviour tests pass.
2. Write the five new roles. One eval case each.
3. `sdlc` process file with tier → stage selection; prove parity with `sdlc-v1` on the v1 evals.
4. Rework transitions and `max_rework` escalation.
5. Escalation up `reports_to`.
6. `saw goal "<text>"`: creates a goal item at `discover` and ticks.
7. `saw org standup`.
8. End-to-end eval: a small feature in a fixture repo, goal to draft PR, with scripted human approvals.

## Testing

- Unit: tier → stage selection table; rework counter; standup digest from a fixture board.
- Lint: every role and the process pass `saw org lint`; every `consumes` has an upstream `produces`.
- Evals (in `evals/`): one case per new role, plus the end-to-end case. Assertions read the event log, not the model's claims.
- A/B: `saw eval --ab` for tokens and pass rate against v1.

## Acceptance criteria

- The end-to-end eval reaches a draft PR with all `verify.<tier>.run` checks recorded per item.
- No role merged, pushed to `main`, or approved a PR in any eval run (asserted from the event log).
- A failing test at `verify` returns the item to `build` with the failure attached, at most `max_rework` times.
- Review reports come from the reviewer roles, never from the implementer (asserted by `from`).
- Token cost for a standard task is within `evals.max_token_increase` of v1.

## Open questions

- More roles means more tokens per task. Recommend that trivial and standard default to a three-role team (lead, implementer, reviewer), and the full team applies from complex up.
- Should `product-owner` read Linear when a ticket is given? Depends on plan 05; recommend yes, read-only.
