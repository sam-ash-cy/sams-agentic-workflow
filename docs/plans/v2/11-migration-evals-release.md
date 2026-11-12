# Plan 11 — Migration, org evals and release (2.0.0-rc.1 → 2.0.0)

**Goal:** v1 users upgrade safely, the org is proven against v1, and 2.0.0 ships.
**Depends on:** all other plans. **Tier:** critical (migration, release).

## Design

### Migration

`saw migrate v2 [--dry-run]`:

1. Snapshot current config (plan 10 snapshots).
2. Add `schema_version = 2` to `workflow.toml`.
3. Map v1 keys to v2. Renamed keys keep a read-only alias for one minor version, with a deprecation line from `saw doctor`.
4. Convert `agents/*.md` overrides in the project to role files.
5. Convert the autopilot queue to board items. `[proposed]` and approved states are preserved.
6. Print a report: changed, kept, needs a decision. Write nothing in `--dry-run`.

A v1 repo that never runs `migrate` keeps working through the compat layer (plan 01). `org.enabled` defaults to `false` on upgrade and `true` on fresh `saw init`.

### Org evals

Extend `evals.ts`:

- **Scenario suites.** A fixture repo, a goal, scripted human decisions, and assertions over the event log and the final tree.
- **Three-way A/B.** saw off · v1 · v2 org, reporting pass rate, tokens, cost, wall-clock and human interventions.
- **Safety suite.** Injection through issue text, a hostile pack, a hostile cloned repo, a role asking for more than its grant, a runaway loop hitting the budget. All must hold.
- **Chaos.** Kill runners mid-item, drop a sync, duplicate a signal.

### Hardening

- Threat model for the whole org (bus, runners, connectors, console, packs) with `appsec-review`.
- Rollback plan: `saw org undo`, `org.enabled = false`, and downgrading the plugin, each tested.
- Performance: `tick` on a board of 1,000 items within a set bound; console usable at that size.
- Privacy: update `PRIVACY.md` for the bus, cloud runs and connectors.

### Docs

`README.md`, `docs/FEATURES.md`, `docs/COMMANDS.md`, `docs/STARTUP.md` rewritten for v2. New `docs/ORG.md` (concepts), `docs/user-guides/` per pack, `docs/test-plans/` per plan derived from the implementation, an upgrade guide, and ADRs for every decision deferred in ADR 0001.

### Release

Follows the existing release-branch flow. Each plan → `saw release` pre-release on `release/v2.0.0`. Publish betas to the `beta` channel branch. When exit criteria hold: rc.1, a soak period, then merge to `main` and `saw release tag`. A person merges and tags.

## Expected touch points

New: `cli/src/migrate.ts`, `evals/org/*`, `docs/ORG.md`, `docs/upgrade-v2.md`.
Changed: `evals.ts`, `release.ts`, `init.ts`, `schema.ts`, all top-level docs, `CHANGELOG.md`, `PRIVACY.md`, plugin and marketplace manifests.

## Steps (failing test first where code changes)

1. Key map v1 → v2 as data, with a test that every v1 key in `defaults.ts` is mapped or explicitly kept.
2. `saw migrate v2` with `--dry-run`.
3. Scenario eval runner and the three-way A/B.
4. Safety and chaos suites.
5. Threat model, fixes, security review.
6. Rollback drills.
7. Docs, test plans, user guides, upgrade guide.
8. rc.1, soak, final release.

## Testing

- Migration: golden tests on fixture v1 repos (minimal, strict profile, autopilot with a queue, custom agents). Migrate then `saw doctor` is clean. Migrate twice is a no-op.
- Round trip: migrate, `saw org undo`, tree equals the original.
- Compat: the v1 suite and v1 evals on an unmigrated repo under the 2.0.0 binary.
- All suites above in CI, with the run output attached to the release PR.
- Human-only checks, named: upgrade one real project; one full goal-to-PR run locally and one in the cloud; console visual pass.

## Exit criteria for 2.0.0

- [ ] All acceptance criteria in plans 01–10 have recorded evidence.
- [ ] v1 suite and v1 evals pass unmigrated and migrated.
- [ ] v2 org pass rate ≥ v1 on shared eval cases; token increase within `evals.max_token_increase` for standard tasks.
- [ ] Safety suite: 100% hold.
- [ ] Threat model reviewed; no open high findings.
- [ ] Rollback drills pass.
- [ ] Every config key documented; `saw memory lint` and docs drift checks clean.
- [ ] No TODOs, no console errors, no lint errors.
- [ ] Owner sign-off.

## Open questions

- Soak length before final: recommend two weeks on the `beta` channel with adoption metrics reviewed.
- Should 2.0.0 turn `org.enabled` on for upgraded repos? Recommend no; opt in via `saw setup`.
