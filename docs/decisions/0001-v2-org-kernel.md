# ADR 0001: saw 2.0 is built on an org kernel with pluggable runners

- Status: **proposed** (awaiting owner approval)
- Date: 2026-11-12
- Supersedes: nothing. First recorded decision.

## Context

v1 is a single-agent workflow: one session, a tier, a playbook, and hooks that enforce routing, verification and safety. Autopilot and `saw split` add headless and parallel sessions, but agents do not hold roles, do not communicate, and stop at the PR.

The owner wants a team of agents that mirrors a real organisation across the whole lifecycle, including maintenance and business functions, that runs locally, in the cloud or self-hosted, reaches external systems through connectors, and is configured and managed in one click.

## Options considered

1. **Add an org layer on top of the v1 kernel.** Lowest risk. But tier and playbook stay the root concepts, so every team that is not a dev team has to pretend to be one.
2. **New org kernel, v1 as a compat layer.** Roles, teams, processes, board and bus become the root. Tier and playbook are re-expressed as one process. Higher regression risk on guard and verify.
3. **Full rewrite.** Loses the eval baseline and adoption data.

For the runtime: a long-running Agent SDK daemon, Claude Code native messaging only, or a file-backed protocol with runner adapters.

## Decision

Option 2, with a file-backed protocol and runner adapters.

- The kernel is deterministic TypeScript in `cli/src/org/`. It makes no model calls.
- Agents are role files. They communicate only through the bus.
- A runner adapter decides where a role executes. Six ship in 2.0.0: subagent, session, worktree, claude-cloud, github-actions, worker.
- guard, verify, autonomy and budgets are kept and extended with role identity. They are not rewritten.
- Connectors are MCP servers resolved from the registry, pinned in `deps.lock.toml`, granted per role.
- The UI is the existing dashboard server and pane, extended.
- Every behaviour is a config key. Guardrail keys only tighten from committed layers.

## Consequences

- Positive: one model covers a feature, a project and a business. Cloud, local and human participants are interchangeable. History is durable and auditable.
- Negative: a second vocabulary (role, team, process, item) sits beside tier and playbook until v1 terms are retired. The compat layer must be tested against the existing eval suite on every beta.
- Risk: guard regressions. Mitigation: identity is additive; with no role set, guard behaves exactly as v1, proven by the unchanged v1 test suite.
- Risk: runaway cost from many agents. Mitigation: budgets per role, team and business; a dispatcher concurrency cap; `saw org stop`.
- Risk: prompt injection through connector content reaching a privileged role. Mitigation: trust labels on messages and a human gate between external-read and outward-write.

## Not decided here

Bus transport for cloud sync, the pack trust model, and worker authentication. Each is an open question in its plan and gets its own ADR.
