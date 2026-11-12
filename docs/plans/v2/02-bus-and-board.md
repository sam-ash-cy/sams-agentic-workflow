# Plan 02 — Bus and board (2.0.0-beta.2)

**Goal:** agents and humans can exchange messages and track work, durably, with no agent running.
**Depends on:** 01. **Tier:** complex.

## Design

### Work item

`goal → epic → item`. One JSON file per item under `.saw/org/board/`.

```json
{ "id": "itm_01J...", "rev": 3, "kind": "item", "parent": "epc_...", "title": "...",
  "process": "sdlc", "stage": "build", "owner": "implementer", "priority": 2,
  "state": "ready|claimed|blocked|waiting_human|done|cancelled",
  "accept": ["..."], "artifacts": {"plan": "docs/plans/x.md"},
  "evidence": [{"check": "test", "result": "pass", "at": "..."}],
  "budget": {"tokens": 0, "usd": 0}, "claimed_by": null, "lease_until": null }
```

Claims are leases with an expiry, so a dead runner releases its item. Stage changes go through the kernel, which checks the gate.

### Message

Append-only JSONL, one file per thread, under `.saw/org/threads/`.

```json
{ "id": "msg_...", "ts": "...", "thread": "thr_...", "item": "itm_...",
  "from": "qa-engineer", "to": "implementer | team:engineering | topic:release | human",
  "type": "request|reply|handoff|decision|review|escalation|status",
  "trust": "internal|external", "body": "...", "artifacts": [], "needs_ack": true }
```

- `handoff` carries the artifacts the next stage `consumes`; the kernel rejects a handoff with a missing artifact.
- `decision` messages flagged `architectural` are written to `docs/decisions/` as ADR drafts.
- `escalation` routes up `reports_to`, ending at `human`.
- An inbox is a query over threads: unacked messages addressed to a role, its team, or a topic it subscribes to.

### Transports

Interface: `append`, `read`, `sync`.

| Transport | Use | Notes |
|---|---|---|
| `fs` | local, default | `.saw/org/`, gitignored |
| `git` | cloud and multi-machine | an orphan branch `saw-org`, never `main`; push goes through autonomy |
| `github` | optional mirror | items as issues, threads as comments |

Concurrency: appends are line-atomic; items use compare-and-swap on `rev`; `git` transport retries on non-fast-forward.

### Reuse

Build on `events.ts` for the append log and `session-state.ts` for leases. Bus events feed `metrics.ts`.

## Expected touch points

New: `cli/src/org/{board,bus,inbox,transport-fs,transport-git,transport-github}.ts`, `schema/item.schema.json`, `schema/message.schema.json`.
Changed: `events.ts`, `metrics.ts`, `main.ts`, `sanitize.ts` (redact message bodies in exports).

## Steps (failing test first for each)

1. Item store with CAS and leases. `saw board add|list|show|move|claim|release`.
2. Thread store. `saw msg send|inbox|ack|thread`.
3. Gate check on `move`; artifact check on `handoff`.
4. Escalation routing and the `human` inbox.
5. `fs` transport, then `git`, then `github` behind `features.bus_github`.
6. Secrets scan on message bodies before append (reuse the guard's secret patterns).
7. Config: `[bus] transport, branch, retention_days`, `[board] lease_minutes`.

## Testing

- Unit: state transitions as a table (from, action, to, allowed?); inbox query; escalation chain.
- Concurrency: spawn N real `saw board claim` processes on one item; assert one winner. Repeat 50 times.
- Transport contract: one shared test suite run against `fs`, `git` (two temp clones and a bare remote) and a faked `github`.
- Time: inject the clock; never sleep in tests.

## Acceptance criteria

- Two processes claiming one item: exactly one wins.
- An expired lease returns the item to `ready`.
- `saw board move` to a stage whose gate has not passed is refused with the missing evidence named.
- A message containing a secret pattern is refused.
- `git` transport: two clones append to one thread, both messages survive after sync, in timestamp order.
- External-origin messages cannot be written with `trust: internal`.

## Open questions

- Is `saw-org` as an orphan branch acceptable, or should the bus live in a separate repo? Recommend the orphan branch; simplest for cloud runners. Needs its own ADR.
- Retention: recommend pruning threads of `done` items after 90 days, configurable.
- The `github` transport posts on your behalf. Confirm it is wanted in 2.0.0 or defer.
