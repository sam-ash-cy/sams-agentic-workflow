# Plan 01 — Org kernel (2.0.0-beta.1)

**Goal:** the data model and enforcement base everything else stands on. No agents run yet.
**Depends on:** nothing. **Tier:** critical (touches guard and autonomy).

## Design

### Scopes and config layers

`default → global → business → project → local`. `business` is new: `~/.saw/businesses/<id>/business.toml`, listing member projects. A project names its business with `org.business = "<id>"`. Same merge and tighten-only rules as v1.

### Role file

`roles/<id>.md` in a project, a business, `~/.saw/roles/`, or a pack. Nearest scope wins by id.

```markdown
---
id: qa-engineer
title: QA Engineer
team: engineering
reports_to: tech-lead
model: sonnet            # or a [models.roles] key
effort: medium
runner: session          # subagent | session | worktree | claude-cloud | github-actions | worker
subscribes: [handoff.implemented, review.requested]
produces: [test-plan, test-report]
consumes: [acceptance-criteria, diff]
connectors: { linear: [read], playwright: [all] }
paths: { write: ["tests/**", "docs/test-plans/**"], read: ["**"] }
autonomy: { commit: propose, push: ask, send_message: ask }
budget: { tokens_per_item: 150000, usd_per_day: 5 }
---
Duties, standards and handoff rules, in prose.
```

### Team and process

`teams/<id>.toml`: member roles, lead, process id. `processes/<id>.toml`: stages, each with `owner`, `requires` (artifacts), `gate` (`check:<name>`, `review:<role>`, `human`, `none`), and `next`. Transitions are data; the kernel validates the graph (reachable, no orphan stage, every owner exists).

```toml
# processes/sdlc.toml
id = "sdlc"
[stages.build]
owner = "implementer"
requires = ["plan"]
produces = ["diff", "tests"]
gate = "check:test"
next = ["verify"]
tiers = ["trivial", "standard", "complex", "critical"]
```

### Identity in guard

Runners set `SAW_ROLE` and `SAW_ITEM`. Guard resolves the role and intersects its grants with `[safety]` and `[autonomy]`. Intersection only: a role can never exceed the layer config. With `SAW_ROLE` unset, behaviour is v1 exactly.

### v1 compat

A built-in process `sdlc-v1` reproduces today's tier paths. `saw task start --tier t --playbook p` opens a work item on it with a built-in `solo` role. v1 commands, hooks and settings keep working.

## Expected touch points

New: `cli/src/org/{scope,role,team,process,identity}.ts`, `schema/role.schema.json`, `schema/team.schema.json`, `schema/process.schema.json`, `templates/processes/sdlc-v1.toml`.
Changed: `config.ts`, `defaults.ts`, `schema.ts`, `guard.ts`, `model-guard.ts`, `task.ts`, `main.ts`, `lint.ts`.

## Steps (failing test first for each)

1. Schema and parser for role, team, process. Reject unknown keys.
2. Scope resolver and the `business` config layer. `saw explain` shows the new layer.
3. Process graph validator. `saw org lint`.
4. Identity resolution and grant intersection in guard.
5. `sdlc-v1` process and the `solo` role; route `saw task` through them.
6. Commands: `saw role list|show|new`, `saw team list|show`, `saw process show`, `saw org lint`.
7. Config keys: `[org] enabled, business, default_team, default_process`. Docs rows.

## Testing

- Unit: parser accept/reject tables; layer merge with the business layer; grant intersection as a truth table (role level × layer level → effective level).
- Property: for random role grants and layer configs, effective permission is never looser than the layer.
- Regression: the whole v1 suite, run twice (`org.enabled` false, then true with no role).
- Fixture: a hostile cloned repo whose role file asks for more than the user's layers allow.

## Acceptance criteria

- The full v1 test suite passes unchanged with `org.enabled = false` and with it `true` and no role set.
- A role granting `push: auto` under a project with `autonomy.actions.push = "ask"` resolves to `ask`.
- A role file from a cloned repo cannot widen `paths.write` beyond `[safety]` deny rules.
- `saw org lint` fails on a process with an unreachable stage, an unknown owner, or a cycle with no gate.
- `saw eval --ab` pass rate is not lower than v1.0.4.

## Open questions (pause conditions)

- Frontmatter is YAML in Claude Code agent files but saw config is TOML. Recommend YAML frontmatter so a role file is also a valid Claude Code agent file. Confirm.
- Does a YAML parser already exist in the repo, or is this a new dependency?
- Critical tier: needs a threat model and rollback plan before build.
