# Plan 08 — Operations: after release (2.0.0-beta.8)

**Goal:** the team keeps looking after what it shipped: triage, dependencies, incidents, upkeep.
**Depends on:** 04, 05, 07. **Tier:** complex. Incident and deploy paths are critical.

## Roles (pack `operations`)

| Role | Trigger | Produces | Default autonomy |
|---|---|---|---|
| `triage` | new issue, error-tracker event, support ticket | labelled, deduplicated, prioritised board item with repro notes | read; writes to the board only |
| `maintainer` | schedule (weekly) | dependency update PRs, one per group, with changelog and risk notes | draft PR |
| `sre` | alert from monitoring, failed deploy | incident item, timeline, suspected cause, proposed mitigation | read-only on production; never runs infra |
| `incident-commander` | `sre` escalation at sev1/sev2 | coordination thread, status updates draft, postmortem draft | outward messages at `ask` |
| `debugger` | bug item from triage | root cause with evidence, fix PR, regression test | draft PR; follows the debug playbook |
| `auditor` | schedule, or pre-release | findings from the existing whole-project auditors | read-only |
| `docs-keeper` | merge to main | doc drift fixes (living docs) | draft PR |
| `cost-watcher` | schedule (daily) | spend report per role and team, budget suggestions | read-only |

## Process `operate`

```
signal ─▶ triage ─▶ ┬─ bug ──────▶ diagnose ─▶ (sdlc: build → … → release)
                    ├─ incident ─▶ mitigate(human) ─▶ fix ─▶ postmortem ─▶ learnings
                    ├─ upkeep ───▶ (sdlc: build → verify → review)
                    └─ noise ────▶ close with reason
```

- `operate` hands work into `sdlc` by creating items there; the two processes link by `parent`.
- **Mitigation is always a human gate.** Agents propose rollbacks, flag flips and restarts with the exact command; a person runs it.
- Postmortems write to `docs/learnings/`. A repeated cause feeds the existing retro proposals (`retro.ts`, `failures.ts`).
- The release stage of `sdlc` gains an exit step: open an `operate` watch item for N days that subscribes to alerts tagged with the release.

## Signals

Uses plan 05 triggers. Shipped presets, each off until its connector is installed: GitHub issues, Linear, Datadog monitors and error tracking, PagerDuty, Sentry-style error events, scheduled cron. All arrive `trust: external`.

## Expected touch points

New: `templates/packs/operations/{roles,teams,processes}/…`, `cli/src/org/schedule.ts`.
Changed: `connect/triggers.ts`, `retro.ts`, `failures.ts`, `release.ts`, `playbooks/debug.md`, `playbooks/audit.md`, `playbooks/hardening.md`.

## Steps (failing test first where code changes)

1. Scheduler: cron-style triggers evaluated in `tick`, with a persisted last-run so a missed tick catches up once.
2. `operate` process and the link into `sdlc`.
3. `triage` with dedupe (same fingerprint → same item).
4. `maintainer`, reusing `deps.ts` grouping.
5. `debugger`, wired to the debug playbook.
6. `sre` and `incident-commander`; severity rules as config.
7. `auditor`, `docs-keeper`, `cost-watcher`.
8. Release watch item.
9. Config: `[ops] enabled, severity.*, watch_days`, `[schedule.<id>]`.

## Testing

- Unit: scheduler catch-up; dedupe fingerprints; severity routing table.
- Fixture signals: recorded issue, alert and error payloads drive `triage` end to end with the fake runner.
- Injection fixture: an issue body containing instructions. Assert the item is `external`, and that no outward or write action occurs without a gate.
- Evals: one per role. `debugger` eval must show a failing test before the fix.
- Assert from the event log that no ops role ran an infra or deploy command.

## Acceptance criteria

- A duplicate signal updates the existing item instead of creating a new one.
- A sev1 alert produces an incident item, an escalation to `human`, and a mitigation proposal with the command, unexecuted.
- A dependency update lands as a draft PR with checks recorded.
- A postmortem appears in `docs/learnings/` and `saw memory lint` passes.
- Instructions embedded in external content are not acted on (injection fixture).

## Open questions

- Which monitoring and ticketing stack to ship presets for first? Recommend GitHub issues, Linear and Datadog, since they are already connected here.
- Should `triage` be allowed to comment on the source issue? That is posting on your behalf; recommend `ask` by default.
