# Phase 2: skeleton and CLI core

## Goal
A working `saw` CLI that resolves layered settings, guards `[safety]`, and can initialise a project without overwriting anything silently.

## In scope
- `.claude-plugin/plugin.json` with `bin/` on PATH (ADR 0012).
- `cli/`: a TypeScript CLI run by bun. **No runtime dependencies**: TOML is parsed with bun's built-in `Bun.TOML.parse`; a small serializer writes it back.
- Layers (later wins): defaults → `~/.saw/config.toml` → `workflow.toml` → `workflow.local.toml` → `--set key=value`.
- `[safety]` guard: the committed `workflow.toml` may only tighten safety keys; a weakening is dropped with a warning.
- Commands: `config get|set|unset|show [--resolved]`, `doctor`, `init [--dry-run]`, `sync`.
- `init` writes `workflow.toml`, a `docs/` vault skeleton, and a `.gitignore` entry for `workflow.local.toml` and `.saw/`. An existing file is skipped, or backed up to `*.bak` with `--force`. Every run prints installed / skipped / backed up.
- `sync` writes `.saw/resolved.json` (the resolved config). Hook and agent generation waits for Phases 3–4, when those exist.
- `schema/workflow.schema.json`, `/saw-settings` skill, CI on Windows/macOS/Linux.

## Out of scope
Router, playbooks, hooks (Phase 3); agents and `saw deps` (Phase 4); metrics (Phase 6).

## Tests (`bun test`)
Config precedence and source tracking; safety guard; unknown-key detection; TOML round-trip; `init` dry-run writes nothing; `init` is idempotent; `--force` backs up.

## Open for the owner
- Type-checking needs `typescript` + `@types/bun` as dev dependencies. Not added yet; approve to add them and a `typecheck` CI step.
