# Phase 4: review agents and pinned dependencies

## Goal
Independent, read-only reviewer subagents whose models follow `[models]`, and third-party skills that are pinned by SHA, licence-checked and reviewed before every update.

## In scope
- `agents/`: researcher, arch-reviewer, code-reviewer, security-reviewer, ui-verifier.
  - Each one is read-only, except that ui-verifier can also use the browser.
  - Each has `maxTurns`, and returns a summary of at most 30 lines with file:line references, never dumps.
  - Each declares its `[models.roles]` role in a `role:` frontmatter line.
- `saw sync` (extended): rewrites each agent's `model:` from the resolved `[models]`.
  - In `routed` mode a role maps to cheap, mid or strong, and then to a model name.
  - In `single` mode the agent gets `inherit`, and sync prints `CLAUDE_CODE_SUBAGENT_MODEL` advice.
  - `--plugin-dir` points it at a plugin checkout (default: this repo).
- `deps.lock.toml`: each dependency's repo, SHA, licence, reviewed_by and reviewed_on.
- `saw deps`:
  - `list`
  - `verify`: fails on a SHA that isn't 40 hex characters, a licence outside `[deps] allowed_licences`, or a missing reviewer
  - `diff <name> <sha>`: prints the GitHub compare URL to review
  - `pin <name> <sha> --reviewed-by <who>`: writes the new pin, only after `diff`
- CI runs `saw deps verify`.
- ADR 0014 (autonomous runner, proposed) rides along on this branch, at the owner's request.

## Out of scope
- **Deleting the owner's overlapping global skills** (plan, orchestrator, debugging, research, session-handoff, code-review-checklist). They live in `~/.claude`, outside this repo. Removing them needs the owner's go-ahead, and the Phase 7 evals showing the replacements pass first.

## Tests
- Model mapping, routed and single.
- sync rewrites only the `model:` line, and is idempotent.
- deps verify catches a bad SHA, a disallowed licence and a missing reviewer.
- pin updates the lock.
