# Plan: audit fixes

Source: [AUDIT-2026-11](../AUDIT-2026-11.md). Branch `feat/audit-fixes`, cut from `feat/phase-9-style`: Phase 9 is pushed but its PR isn't merged, so this branch includes it and must merge after it (or be rebased onto `main` once Phase 9 lands).

## Phases (each with tests)
1. **Guard** — `saw guard`, a PreToolUse hook on Bash: `safety.deny` patterns and `safety.push = never` deny; `ask` actions in `autonomy.actions` (commit, push, open_pr, add_dependency) ask; `never` denies. Safety is always on; it has no feature toggle.
2. **Budgets** — `saw context` also compares tokens spent since the open task started with `tokens.budget[tier]`: soft warns at `warn_at` and at 100%; hard tells the agent to stop at a safe point and write a handoff. Gated by `features.budgets`.
3. **Post-edit format** — `saw format-hook`, a PostToolUse hook on Edit/Write runs `checks.format` (quiet, recorded like `saw run`) when `features.format_hook` is on and a command is set.
4. **Honest toggles** — `saw doctor` lists toggles with no mechanical effect (advisory: read by skills only) so settings don't overclaim; `doctor --hooks` runs each hook with an empty payload and reports failures.
5. **Critical rollback** — `rollback_plan` is a judgement check required for critical tasks.
6. **Memory lint** — `saw memory lint`: stale `path` references in docs/learnings and docs/decisions, duplicate learning titles, plus the context size limits.
7. **Report** — `saw task report`: Markdown Verified/Partial/Not verified/Blocked body for a PR description, from `task status`.
8. **Secret scan** — the template pre-commit runs `gitleaks protect --staged` when gitleaks is installed.

9. **Every setting acts** (added requirement). `cli/test/settings.test.ts` fails when a default key isn't read by `cli/src` or `hooks/` (allowlist: `project.type` only, with a reason), and flip-tests each toggle:
   - grilling, tdd, trail, `routing.always_grill` → the `steps:` line `saw task start` prints; `routing.default_tier` → tier when `--tier` is omitted.
   - code_review / security_review → dropped from `[verify]`; model_routing → agents inherit; obsidian → `vault sync` and the dashboard note; dashboard, audit → refused when off.
   - `autonomy.level = suggest` → guard denies every action; `safety.destructive_approval` / `deploy_approval` → ask; `safety.no_secrets` → deny printing `.env*`; `autonomy.actions.edit_global` → guard on edits under `~/.claude`, `~/.saw`.
   - Removed (no mechanism on this branch): `features.router`, `quiet_output` (duplicate of `output.quiet`), `rederive`, `parallel_sessions`, `worktrees`, `self_improve` (duplicate of `autonomy.actions.self_improve`), `autonomy.actions.spawn_sessions`, `metrics.fields`.
10. **Security fix** — `saw format-hook` ignores a `checks.format` that comes from the committed `workflow.toml` (a cloned repo could otherwise run commands on the first edit); set it in `workflow.local.toml` or `~/.saw/config.toml`.

## Answered and built (round 2)
11. **`saw run <check> --changed`** — naming convention (`foo.test.ts`, `foo.spec.js`, `test_foo.py`, `foo_test.go`, `FooTest.php`); full suite when nothing maps; recorded with note "changed files only". Paths are filtered before reaching the shell.
12. **`saw uninstall` / `saw init --upgrade`** — `.saw/installed.json` holds content hashes; only files unedited since install (or equal to the current template) are removed or updated. `workflow.toml` is never replaced by an upgrade.
13. **`checks.dep_audit`** — `saw init` writes it from the lockfiles found (bun/npm/pnpm/yarn/composer/pip/cargo/go).
14. **`[audit]` catalogue** (ADR 0013) — `audit.auditors`, `triggers`, `token_budget`; `saw task start` lists them on a triggering tier or playbook.
15. **`saw task report --post`** — `gh pr comment`, gated by `autonomy.actions.open_pr` (never: refused; ask: needs `--yes`).
16. **`saw repo plan|apply`** (ADR 0015) — `[repo]` merge, protect, security, labels; plan is read-only; apply needs `--yes` (and the guard asks), reports plan-gated 403/404 as skipped, then re-reads to verify. Uses branch protection, not rulesets.
17. **`saw outline <file>`** — regex signatures for TS/JS, Python, PHP, Go, Rust, Java, C#, Ruby.

## Still open
- Eval baseline: run `saw eval --save-baseline` yourself (paid run).
- `saw run` as a PreToolUse rewrite (ADR 0012): kept as an explicit command.
- Bootstrap scripts and `global/` fragment: Phase 11.
- `saw init --repo` offering a plan (ADR 0015): not added.

## Questions (earlier round, now answered)
- **Removed keys** — bring back `spawn_sessions`, `parallel_sessions` and `worktrees` with Phase 10 (sessions) when they get a mechanism? `features.router`: is disabling the plugin enough? Per-playbook toggles from the blueprint were never added: wanted?
- **Feature toggles that unload skills/agents.** Plugin skills can't be disabled per project from the plugin itself. Option: `saw sync` writes `.claude/settings.json` permission denies for disabled skills' `Skill(...)`.
- **`saw repo plan|apply` (ADR 0015)** — needs the `[repo]` schema and a confirm flow against the live GitHub API.
- **`[audit]` catalogue (ADR 0013)** — which auditors, their sources and budgets.
- **`saw run` as a PreToolUse rewrite (ADR 0012)** — conflicts with the current explicit `saw run`; keep explicit?
- **Eval baseline** — needs a real `claude plugin eval` run (cost); run `saw eval --save-baseline` yourself.
- **Affected-tests selection** — mapping rule (Trail callers vs naming convention) per project type.
- **`saw uninstall` / `init --upgrade`** — what counts as user-modified, and 3-way diff behaviour.
- **`saw outline`, bootstrap scripts, `global/` fragment** — likely folded into Phase 11.
- **Per-type `checks.dep_audit` defaults** — which tool per `project.type`.
- **PR posting via `gh`** — `saw task report` prints only; posting is an outward action.
