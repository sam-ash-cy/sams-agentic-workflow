# Plan 07 — Cloud and self-hosted runners (2.0.0-beta.7)

**Goal:** the org keeps working with your laptop closed. Each role picks where it runs.
**Depends on:** 03, and 02's `git` transport. **Tier:** critical (credentials, remote execution, CI).

## Design

Three runners behind plan 03's interface. Default recommendation: `claude-cloud` and `github-actions` enabled, `worker` available.

| Runner | Triggered by | Good for | Needs |
|---|---|---|---|
| `claude-cloud` | schedule, or the dispatcher starting a cloud session | long builds, scheduled maintenance, anything that ends in a PR | a Claude cloud environment for the repo |
| `github-actions` | GitHub events (issue labelled, PR opened, comment, cron, `workflow_dispatch`) | event-driven roles: triage, review, release notes | an API key secret in the repo; Actions minutes |
| `worker` | `saw worker` polling the bus | private networks, own hardware, full control | a box or container you run |

### How a remote run works

1. The dispatcher (local, or a scheduled remote `saw org tick`) claims an item and calls the runner.
2. The runner starts a remote session whose first step is: check out the repo, install saw at the pinned version, fetch the `saw-org` branch, read the assignment by item id.
3. The agent works as its role, under the same guard, with `SAW_ROLE` and `SAW_ITEM` set.
4. It pushes its work branch, opens a **draft** PR, posts a `handoff` to the bus, and pushes `saw-org`.
5. The next tick, anywhere, sees the handoff.

No runner holds state. The bus is the only shared memory, so a run can start in the cloud and continue locally.

### `saw cloud` commands

```bash
saw cloud init                 # writes .github/workflows/saw-org.yml and a routine definition; prints the secrets to add
saw cloud status               # which runners are reachable; last run per role
saw cloud tick --runner github-actions   # dispatch a remote tick now
saw worker start|stop|status   # self-hosted; docker-compose service provided
```

`saw cloud init` drafts files. It never sets secrets, never provisions infrastructure, and never pushes.

### Remote guardrails

- Remote roles get a **cloud autonomy profile**, tighter than local by default: draft PRs only, no merge, no push to `main`, no deploy, outward connectors at `ask` (which, unattended, means the item waits in Approvals).
- The generated workflow uses least-privilege `permissions:` and pins actions by commit SHA.
- Workflows triggered by forks or by untrusted comment text run with no secrets and `trust: external`.
- Budgets are enforced by the dispatcher before a run starts and by the runner's max-turns and timeout during it.
- `saw org stop` cancels remote runs through each runner's `stop`.

## Expected touch points

New: `cli/src/org/{runner-claude-cloud,runner-github-actions,runner-worker}.ts`, `cli/src/cloud.ts`, `cli/src/worker.ts`, `templates/cloud/saw-org.yml`, a `worker` service in `docker-compose.yml`.
Changed: `autopilot.ts` (cloud preset), `repo.ts` (workflow as code), `init.ts`, `profiles.ts`.

## Steps (failing test first for each)

1. **Spike, before anything else:** confirm from current docs how to start a Claude Code cloud session or routine programmatically, and the current GitHub Action for Claude Code with its inputs. Write the findings to `docs/learnings/`. Adjust this plan.
2. `worker` runner and `saw worker` (fully testable locally).
3. `github-actions` runner and workflow template.
4. `claude-cloud` runner.
5. Cloud autonomy profile and fork/untrusted handling.
6. `saw cloud init|status|tick`.
7. Config: `[runners.claude-cloud]`, `[runners.github-actions]`, `[runners.worker]`, `[cloud] autonomy_profile, max_parallel`.

## Testing

- `worker`: integration test with two worker processes and a bare git remote; kill one mid-item and assert the lease recovers.
- `github-actions`: unit-test the generated YAML (permissions, pinned SHAs, no secrets on fork triggers); a fake `gh` for dispatch and cancel.
- `claude-cloud`: adapter tested against a recorded fake; one real smoke run, manual, named below.
- Security review of the workflow template is a required check.
- Human-only checks, named: one real GitHub Actions run and one real cloud run in a scratch repo.

## Acceptance criteria

- An item claimed by a remote runner ends as a draft PR plus a `handoff` visible locally after sync.
- No remote run can merge, push to `main`, or deploy under the default profile (tested against the guard with the cloud profile).
- A workflow triggered from a fork receives no secrets.
- Killing a worker returns its item to `ready` after the lease.
- `saw cloud init` writes no secret and makes no network call.

## Open questions (pause conditions)

- Worker authentication to the git remote and the model API: which credential, and where it lives. Needs its own ADR. A credential the agent does not have is required to test for real.
- Global rules forbid running infrastructure commands; this plan only drafts them. Confirm `docker compose up` for the worker is yours to run.
- Threat model and rollback plan required before build.
