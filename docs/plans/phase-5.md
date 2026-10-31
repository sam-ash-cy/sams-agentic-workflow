# Phase 5: project template and docs vault

## Goal
`saw init` gives a project everything the workflow needs: lean context files to fill in by hand, an Obsidian-compatible `docs/` vault, CI, and git hooks. Re-running it is safe on any repo, including one that already has its own docs and CLAUDE.md.

## In scope
- `templates/project/`:
  - **AGENTS.md:** a skeleton of at most 30 lines with headings and prompts. It holds commands and non-obvious rules only, and is filled in during the foundation playbook (never generated; ETH paper, ADR 0012).
  - **CLAUDE.md:** `@AGENTS.md` plus Claude-only notes.
  - **docs/:**
    - `index.md` (vault home, with wikilinks)
    - `glossary.md`
    - `conventions.md`
    - `decisions/0000-template.md`
    - `features/_template.md`
    - learnings and plans READMEs
  - **`.github/workflows/saw.yml`:** runs `saw doctor` and `saw lint-context` on a pinned saw ref (`deps verify` checks the plugin's own lock, so it stays in the plugin's CI).
  - **`.githooks/pre-commit`:** runs `saw lint-context` when saw is on PATH, and skips with a notice otherwise.
- `saw init`:
  - **`--type <web|api|cli|lib|infra>`:** writes `project.type` into a freshly installed workflow.toml.
  - **`--hooks`:** runs `git config core.hooksPath .githooks`. This only happens on request, because it changes repo config.
  - When it finishes, it prints next steps: run the foundation playbook, and fill in AGENTS.md.
- Fix: `saw sync` keeps CRLF line endings on the `model:` line (Windows checkouts).

## Verification
- Tests:
  - the template's AGENTS.md and CLAUDE.md pass `lint-context`
  - `--type` writes the type
  - init doesn't touch an existing CLAUDE.md
- `saw init --dry-run`, then `saw init`, on a scratch repo.
- The same on a **clone** of aws-security-lab in the scratchpad. The original is not touched.
