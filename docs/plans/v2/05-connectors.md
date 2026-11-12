# Plan 05 — Connectors (2.0.0-beta.5)

**Goal:** any agent can be given any of thousands of external tools in one command, pinned and scoped.
**Depends on:** 01. Can run in parallel with 02–04. **Tier:** critical (credentials, external reach).

## Design

No saw connector format. A connector is an MCP server.

```bash
saw connect search "crm"                 # registry + recommendations.toml
saw connect add hubspot --scope project  # writes config, pins in deps.lock.toml
saw connect grant hubspot sales-rep read # edits the role file
saw connect doctor                       # auth state, missing env, drift from lock
```

### Catalogue

- Source 1: the MCP registry. Confirm the endpoint, schema, pagination and rate limits from current docs before building.
- Source 2: `recommendations.toml`, already in the repo, becomes the curated, vetted layer and wins on conflict.
- Results cached under `~/.saw/cache/registry/` with a TTL. Search works offline against the cache.

### Install

Writes the server entry to the right Claude Code settings layer for the chosen scope, and records name, source, version and integrity in `deps.lock.toml` (extending the pinning and licence check in `deps.ts`). Remote (HTTP) servers are recorded by URL. Local (stdio) servers are pinned by package version and hash.

### Grants

A role's `connectors` map lists server → capabilities: `read`, `write`, `all`, or explicit tool names. A connector's tools are classified once at install (`saw connect classify`): read-only, write, outward (sends, publishes, spends). Guard denies any `mcp__<server>__<tool>` call the role is not granted. With no role set, v1 behaviour.

### Safety

- Credentials only from the environment or the MCP client's own OAuth store. Never written by saw.
- Outward tools default to `ask`, whatever the grant.
- **Separation rule:** if a role's grants include both an external-content reader and an outward writer, `saw org lint` warns and the process must put a gate between them.
- Tool results are data. The assignment text says so; trust labels (plan 02) carry it across the bus.

### Events in

A connector can be a **trigger**: `[triggers.<id>] source, filter, creates` turns an external event (issue labelled, alert fired, form submitted) into a board item with `trust: external`. Polling triggers run in `tick`. Webhook triggers arrive through the cloud runners (plan 07).

## Expected touch points

New: `cli/src/connect/{registry,install,grants,classify,triggers}.ts`.
Changed: `recommend.ts` (becomes a thin alias), `deps.ts`, `guard.ts`, `recommendations.toml`, `lint.ts`, `init.ts`.

## Steps (failing test first for each)

1. Registry client with cache.
2. Install and uninstall per scope; lock entries; licence check.
3. Tool classification with manual override in config.
4. Grant enforcement in guard.
5. Separation-rule lint.
6. Polling triggers.
7. `saw connect search|add|remove|grant|revoke|classify|doctor|list`. `saw recommend` keeps working.
8. Config: `[connectors] registry_url, cache_hours, default_capability, allow_unlisted`.

## Testing

- Registry: recorded fixture responses only. No network in `bun run test`.
- Install: against a temp `$HOME` and temp project; assert the exact settings and lock diff.
- Grants: truth table (role grant × tool class × autonomy → allow, ask, deny).
- Hostile fixture: a cloned repo that tries to add a global connector and grant an outward tool at `auto`.
- Grep test: no credential-shaped string in any fixture.

## Acceptance criteria

- A role without a grant is denied the tool call, with the role and the missing grant named.
- A cloned repo's `workflow.toml` cannot add a connector to the user's global scope or grant an outward tool at `auto`.
- Installing an unpinned or licence-incompatible server is refused, with an override flag that is logged.
- `saw connect search` returns results offline from cache.
- No test or fixture contains a credential.

## Open questions (pause conditions)

- Editing Claude Code MCP settings touches files that can hold secrets. Global rules require permission first. Recommend saw only adds entries that reference env vars, and asks on first write per scope.
- Threat model required before build.
