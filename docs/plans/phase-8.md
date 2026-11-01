# Phase 8: central vault and agent tiers

## Goal
Learnings can be found across projects in one personal Obsidian vault, and the workflow's rules reach every supported agent, not only Claude Code.

## Built
- **`saw vault sync [--dry-run]`**: writes `<vault>/projects/<project>.md`. This note lists the project's path, task count and Verified rate, and its decisions, features and learnings (wikilinked).
  - With `knowledge.store = vault | both`, it also copies `docs/learnings/*.md` to `<vault>/learnings/<project>/`. The repo copy always wins: a learning edited in the vault is overwritten, with a warning. `both` always warns that there are two copies.
  - `knowledge.vault_path` must be an absolute path to an existing folder, set in `~/.saw/config.toml` or `workflow.local.toml`. A committed `workflow.toml` can't set it, because it would let a repo write outside itself.
- **Agent adapters** (`saw init --agents codex,cursor,gemini`), so each agent reads `AGENTS.md`:
  - Codex and Cursor read it natively. Cursor also gets `.cursor/rules/saw.mdc` (the verification rule, always applied).
  - Gemini CLI gets `.gemini/settings.json` with `contextFileName: ["AGENTS.md"]`.
  - Claude Code reads it through the `@AGENTS.md` import in `CLAUDE.md`.
  - Existing files are never overwritten.
- **`saw agents check`**: smoke test for every agent in `agents.enabled` (default `["claude"]`). CI runs it on a fresh project on all three OSes.

## Out of scope
- **Codex evals** (ADR 0003 puts Codex in Tier 1). `claude plugin eval` only drives Claude, so a Codex runner needs its own grader. That's a separate piece of work.
- **Running Cursor and Gemini themselves in CI.** Tier 2 is an install smoke test by design (ADR 0003).

## Not verified
- Not tried in a real Obsidian vault, Cursor or Gemini CLI. The file formats follow each tool's docs as I know them: `.mdc` rules with `alwaysApply`, and Gemini's `contextFileName` setting.
