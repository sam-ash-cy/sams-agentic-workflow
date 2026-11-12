# Plan 09 — Business scope and business teams (2.0.0-beta.9)

**Goal:** run a whole business as an organisation of agents: several projects, and the teams around them.
**Depends on:** 04, 05. **Tier:** critical (outward communication, money, personal data).

## Design

### Business scope

`saw business new <id>` creates `~/.saw/businesses/<id>/` with `business.toml` (name, goals, member projects, teams, budgets), its own `roles/`, `teams/`, `processes/` and a business-level board. Projects join with `saw business add-project <path>`.

- A business board holds goals that span projects. A goal breaks down into epics placed on a project board, or on a business team's board when no repo is involved.
- Budgets roll up: role → team → project → business.
- A business-level `chief-of-staff` role owns the breakdown and the weekly review. It reports to `human`.

### Pack format

A pack is a folder: `pack.toml` (id, version, licence, required connectors) plus `roles/`, `teams/`, `processes/`, and optional `rubrics/` and `evals/`. Not a new connector format; packs only reference MCP connectors by name.

```bash
saw pack list|show <id>
saw pack add <id> --scope business|project|global
saw pack new <id>          # scaffold your own
```

Packs are pinned in `deps.lock.toml` and pass the same licence and tighten-only rules as roles. A pack can never loosen a guardrail.

### Teams shipped in 2.0.0

| Pack | Roles | Typical connectors |
|---|---|---|
| `product` | product-manager, user-researcher, analyst | analytics, survey, Linear |
| `design` | designer, design-critic, ux-writer | Figma |
| `marketing` | strategist, content-writer, seo, social, campaign-analyst | CMS, analytics, social |
| `sales` | sdr-researcher, account-exec-assistant, proposal-writer | CRM, email |
| `support` | support-agent, knowledge-keeper, escalation-lead | helpdesk, docs |
| `finance` | bookkeeper-assistant, forecaster, invoicing-assistant | accounting, payments (read) |
| `people` | recruiter-assistant, onboarding-buddy | ATS, HRIS |
| `legal-compliance` | policy-checker, contract-reviewer, privacy-reviewer | docs |
| `leadership` | chief-of-staff, strategist, reporter | all read-only |

Use cases are drawn from the 500-AI-Agents-Projects catalogue by industry; each becomes a role or a process template. Roles are written fresh.

### Verifying non-code work

Code has tests. Business artifacts get:

1. **Artifact contracts.** Each `produces` type has a schema (required sections, fields, length).
2. **Rubric review.** A reviewer role scores against `rubrics/<type>.md` and records a judgement check, like code review today.
3. **Fact and source check.** Claims need a cited source from a connector or a file.
4. **Human gate on anything outward.** Sending, publishing, spending, signing and contacting a person stay at `ask`.

### Hard limits

- Finance roles prepare; they never move money. Payment connectors are granted read-only, and saw refuses a `write` grant on a tool classified as funds transfer.
- Legal and finance outputs carry a "draft for professional review" label. They are not advice.
- Personal data: roles declare `data_classes`; a role handling PII cannot hold an outward connector without a gate; exports are redacted by `sanitize.ts`.

## Expected touch points

New: `cli/src/org/{business,pack,rubric,artifact-contract}.ts`, `templates/packs/<nine packs>/…`, `schema/pack.schema.json`.
Changed: `projects.ts`, `config.ts`, `deps.ts`, `profiles.ts`, `sanitize.ts`, `metrics.ts`.

## Steps (failing test first where code changes)

1. Business scope, board and budget roll-up.
2. Pack format, install, pin, lint.
3. Artifact contracts and rubric review as a judgement check.
4. `leadership` and `product` packs first; they exercise the business board.
5. Remaining packs, one at a time, each with evals and a rubric per artifact.
6. Hard limits in guard: funds-transfer refusal, PII separation.
7. Config: `[business]`, `[packs]`, per-pack keys.

## Testing

- Unit: budget roll-up; pack lint; contract validation; funds-transfer refusal; PII separation rule.
- Hostile pack fixture: tries to loosen autonomy and to grant an outward tool at `auto`.
- Evals: per role, scored by rubric with a fixed judge prompt; track variance across `evals.runs`.
- Event-log assertion across all business evals: zero outward actions without a `human` decision.
- Security review with `appsec-review` before merge (payments, PII).

## Acceptance criteria

- A business goal breaks into items on two project boards and one team board, and its spend rolls up correctly.
- A pack installs in one command and passes `saw org lint`.
- A `write` grant on a funds-transfer tool is refused.
- Every shipped role has an eval and every artifact type has a contract and a rubric.
- No business eval run performs an outward action without a human decision.

## Open questions (pause conditions)

- Nine packs is large. Recommend shipping `leadership`, `product`, `marketing` and `support` in beta.9 and the rest in beta.9.x, all before 2.0.0 final.
- Pack trust: who may publish packs to the marketplace, and are they signed? Needs its own ADR.
- Licence of 500-AI-Agents-Projects must be checked before using any of its text.
- Threat model required before build.
