# saw 2.0.0 — the workflow as an organisation

Status: **draft, awaiting owner approval.** Nothing here is implemented. Branch: `release/v2.0.0`.

## Goal

Anyone can configure saw once, then point a team of agents at whatever they are building: a business, a project, or a single feature. Agents hold roles, talk to each other through a durable bus, and carry work through the whole lifecycle, including after release. Everything is a setting. Everything is one command or one click. Every agent stays inside the guard.

## Decisions taken (owner, 2026-11-12)

| # | Decision | Choice |
|---|---|---|
| D1 | Relationship to v1 | New org kernel. v1 tiers and playbooks become a compat layer on top of it |
| D2 | Agent runtime | One protocol, pluggable runners |
| D3 | Roles in 2.0.0 | Full business: dev, ops and business teams |
| D4 | Autonomy | Gated by default, configurable per person, role and action |
| D5 | Offline execution | Claude Code cloud + GitHub Actions by default; self-hosted worker available. Chosen per role |
| D6 | Connectors | MCP registry, pinned, granted per role. No custom connector format |
| D7 | UI | Grow the existing dashboard into an Org Console (pane and browser) |
| D8 | Delivery | Staged betas on this branch, eval-gated |
| D9 | Principle | Everything is configurable; guardrails only tighten from committed files |

Recorded in [ADR 0001](../../decisions/0001-v2-org-kernel.md).

## Architecture

```
            ┌──────────────────────── Org Console (pane / browser) ───────────────────────┐
            │  org chart · agent editor · board · feed · approvals · connectors · costs   │
            └───────────────────────────────┬─────────────────────────────────────────────┘
                                            │ every action is a `saw` command
┌───────────────────────────────────────────▼─────────────────────────────────────────────┐
│ ORG KERNEL (deterministic, no model calls)                                              │
│  Scopes     global → business → project → unit        (config layers, same rules as v1) │
│  Roles      who an agent is: duties, model, runner, grants, autonomy, budget            │
│  Teams      a set of roles plus a process                                               │
│  Process    a state machine of stages; each has an owner role, artifacts and a gate     │
│  Board      work items: goal → epic → item, with state, owner, evidence                 │
│  Bus        append-only threads: request, reply, handoff, decision, review, escalation  │
│  Dispatcher `saw org tick`: reads board + inboxes, picks runnable work, calls a runner  │
└───────┬──────────────────────────┬──────────────────────────┬───────────────────────────┘
        │ enforcement              │ execution                │ reach
┌───────▼────────┐   ┌─────────────▼─────────────┐   ┌────────▼─────────┐
│ guard · verify │   │ Runners                   │   │ Connectors (MCP) │
│ autonomy       │   │ subagent · session ·      │   │ registry search  │
│ budgets        │   │ worktree · claude-cloud · │   │ pinned in lock   │
│ (v1, extended  │   │ github-actions · worker   │   │ per-role grants  │
│ with identity) │   │                           │   │                  │
└────────────────┘   └───────────────────────────┘   └──────────────────┘
```

### Why this shape

- **The kernel never calls a model.** Who works next is a rule over board state, not a judgement. That keeps it testable with `bun run test`, cheap, and auditable. Models only run inside a runner, as a role.
- **Agents do not talk directly.** They post to the bus and read their inbox. A cloud agent, a local subagent and a human in the console are indistinguishable to each other. History is durable, so a session can die and the next one resumes.
- **v1 survives as a process.** `tier` selects which stages and gates of the SDLC process apply. `saw task start` becomes "open a work item with a one-role team". Existing repos keep working.
- **Identity is the new enforcement input.** v1 guard asks "is this action allowed here?". v2 guard asks "is this action allowed here, for this role?".

### Mapping to patterns in [500-AI-Agents-Projects](https://github.com/ashishpatel26/500-AI-Agents-Projects)

That list is a catalogue of use cases built on CrewAI, AutoGen, LangGraph and Agno. We take the patterns and the use-case coverage, not the code.

| Their pattern | saw 2.0 |
|---|---|
| CrewAI role + goal + task | Role file + work item |
| LangGraph state graph | Process (stages, transitions, gates) |
| AutoGen group chat | Bus threads |
| Industry use cases (support, finance, marketing, HR, ...) | Team packs (plan 09), each use case a role or a process template |

Check that repo's licence before copying any text; role files are written fresh.

## Roadmap

Each plan lands as one beta. A beta is usable on its own and must not lower the `saw eval --ab` pass rate.

| Beta | Plan | Delivers | Needs |
|---|---|---|---|
| beta.1 | [01 Org kernel](01-org-kernel.md) | Scopes, role/team/process schema, identity in guard, v1 compat | — |
| beta.2 | [02 Bus and board](02-bus-and-board.md) | Messages, threads, work items, transports | 01 |
| beta.3 | [03 Dispatcher and local runners](03-dispatcher-and-runners.md) | `saw org tick/run`, subagent, session, worktree runners | 02 |
| beta.4 | [04 Dev team and SDLC](04-dev-team-sdlc.md) | Engineering roles and the lifecycle process | 03 |
| beta.5 | [05 Connectors](05-connectors.md) | `saw connect`, registry, grants, lock | 01 |
| beta.6 | [06 Org Console](06-org-console.md) | UI for all of the above | 02, 05 |
| beta.7 | [07 Cloud and self-hosted](07-cloud-and-selfhosted.md) | claude-cloud, github-actions, worker runners | 03 |
| beta.8 | [08 Operations](08-operations.md) | After-release: triage, deps, incidents, SRE | 04, 05, 07 |
| beta.9 | [09 Business](09-business.md) | Business scope, business teams, pack format | 04, 05 |
| beta.10 | [10 One-click setup](10-setup-and-customisation.md) | `saw setup`, presets, role builder, gallery | 06, 09 |
| rc.1 | [11 Migration and release](11-migration-evals-release.md) | `saw migrate`, org evals, docs, hardening, 2.0.0 | all |

05 can run in parallel with 02–04. 06 can start once 02 lands.

## How an implementing agent uses these plans

1. Read this file and ADR 0001, then the one plan you are assigned. Do not start a plan whose "Depends on" has not merged.
2. Open a saw task: `saw task start --tier <plan tier> --playbook foundation --unit phase --unit-id v2-<nn>-<name>`.
3. **Verify the touch points first.** Each plan lists v1 files it probably changes, taken from file names, not from reading them. Confirm with graft/Trail and correct the plan if wrong.
4. Stop on any open question marked as a pause condition and ask the owner.
5. Work the plan's steps in order. Each step is: write the failing test → make it pass → `saw run test`.
6. Finish when every acceptance criterion has recorded evidence. Run code and security review. Open a draft PR into `release/v2.0.0`.
7. Update `docs/FEATURES.md`, `docs/COMMANDS.md` and the schema for every new key and command.
8. After merge, the owner cuts the beta with `saw release`.

Tests run with `bun run test` from the repo root. Never `bun test` inside `cli/`, never `bunx tsc`.

## Cross-cutting rules for every plan

- **Config first.** A feature without a key in `cli/src/defaults.ts`, a schema entry and a row in `docs/FEATURES.md` is not done.
- **Guardrails only tighten.** No role file, pack or connector from a cloned repo may loosen `[safety]` or `[autonomy]` on someone's machine.
- **Untrusted by default.** Bus messages that originate outside the org (connector events, issue text, web content) carry `trust = "external"`. Roles treat them as data. A role that reads external content and holds a write-capable outward connector needs a human gate between the two.
- **Outward actions gate on a human** unless the owner has explicitly raised that role's autonomy: send, publish, spend, merge, deploy, delete.
- **No secrets in files.** Connectors read credentials from the environment.
- **Bun only.** No new runtime dependency without asking.
- **v1 must keep passing.** With `org.enabled = false`, and with it on and no role set, the v1 suite and evals are unchanged.
