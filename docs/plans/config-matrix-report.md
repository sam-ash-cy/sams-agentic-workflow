# saw config matrix report

Test pass of the `saw` CLI and its hooks against every configuration value on branch `feat/phase-13-autopilot` (uncommitted router nudge, untasked-edit gate and doctor plugin check included). Run on 2026-11-01, Windows 11, Bun 1.3.11. No repo source was changed.

## Method

- **Sandboxes.** One template: `git init`, `bun init -y`, `saw init`. Each case gets a fresh copy, with its own `.saw/` removed, `checks.test = "bun --version"` added to `workflow.toml`, and its own temp HOME (`SAW_HOME`, `HOME` and `USERPROFILE` all point into the sandbox). The real `~/.saw` and `~/.claude` were never read or written.
- **Coverage.** 255 cases, one key at a time, not all combinations:
  - every enum value in `ENUMS`
  - every `autonomy.actions.*` value (never, ask, propose, allow) and every `models.roles.*` value (cheap, mid, strong)
  - every boolean both ways
  - one non-default value for each number, string and array key
  - scope cases for global, project and local: a tightening value (`tokens.mode=hard`), a loosening value (`autonomy.actions.commit=allow`) and `features.verify_hook=false`, plus one precedence case with all three layers set
  - one invalid enum and one unknown key
  - all 8 playbooks, plus `audit` with `features.audit=false`
  - the 4 profiles from `docs/reference/profiles.md`
- **Commands per case:**
  - `doctor --no-plugin`, then `config show --resolved`, checking the value and the layer it came from
  - for each tier (trivial, standard, complex, critical): `task start`, checking the printed steps against every feature toggle, then `gate` with the task open, `run test`, `task record code_review pass`, `task status`, `task report`, `context` (no nudge expected) and `task end`
  - `task start` with no `--tier`, to test `routing.default_tier`
  - `guard` with `git push --force`, a project edit, an edit under `~/.claude`, a `[checks]` command (`rewrite_commands`) and `git worktree add` (`features.worktrees`)
  - `context` with no task open (router nudge), then `gate`, then `format-hook` followed by `gate` with no task (untasked edit), a second `gate`, `gate` with `stop_hook_active`, and a check that `task start` clears the marker
  - `session-hook`, `style-check` and `context` against a 900-word, 150k-token transcript, then `dashboard`
  - `.saw/events.jsonl` checked against `logging.enabled` and `logging.level`
- **Harness.** The script lives in the scratchpad, not the repo.

Legend: ✓ pass · ✗ fail (Bn = the bug below) · B1 = gate blocked again on a second, fresh stop · – = not run · ¹ ² ³ ⁴ = harness false positive, corrected after a manual check:
- ¹ `config show` prints arrays without spaces; my string match expected spaces. The value is correct.
- ² `verify.*` overrides change the required checks, so my default-check expectations didn't apply. The gate and status behaved correctly for the new check list.
- ³ The hook's stdout JSON is valid. The config warning goes to stderr, which my harness merged into the output.
- ⁴ `doctor` exits 1 because a project-layer loosening is reported as a problem. That's intended: the value is ignored and the warning names the right layer.

## Doctor plugin check (new)

| case | result |
| --- | --- |
| `claude` on PATH, plugin not installed | ✓ `problem: Claude Code plugin sams-agentic-workflow is not installed …`, exit 1 |
| `--no-plugin` | ✓ check skipped, `saw doctor: ok`, exit 0 |
| `SAW_NO_PLUGIN=1` | ✓ check skipped, exit 0 |
| `claude` not on PATH | ✓ `plugin: skipped (claude not on PATH)`, exit 0 |
| plugin installed but disabled | not tested: it needs a plugin install, which this pass was told not to do |

## Profiles

| profile | result |
| --- | --- |
| solo (local + project) | ✓ every column |
| autopilot (local) | ✓ every column |
| team (project) | ✗ as documented (B3). After merging its tables into the generated `workflow.toml`: doctor ok, every key resolves to `project`, review-session step on standard/complex/critical, gate blocks then passes, guard denies `git push --force`, untasked-edit gate and nudge ok, dashboard ok, events ok |
| strict (project) | ✗ as documented (B3). After merging: every key applies (all tighten), grilling on standard, review session `both`, `terraform destroy` and `kubectl delete` denied, the rest as for team |

## Bugs

Status (2026-11-01): all four are fixed. B1: `gate` clears the marker when it blocks. B2: `validate` rejects an unknown `extends`. B3: `saw profile apply <name>` merges a profile into the existing tables, and the profiles page says so. B4: every format-hook run is logged at debug. `cli/test/workflow-additions.test.ts` applies every documented profile to a `saw init` project twice, and checks the review and docs toggles in every combination against the gate.

**B1 – the untasked-edit gate blocks on every later stop, not once.** No config needed: it happens with defaults and with every case where `features.verify_hook = true` (249 of 255; it didn't show in the 4 `verify_hook=false` cases or the 2 broken profiles). Repro:
1. Run `echo '{"tool_name":"Edit","tool_input":{"file_path":"x"}}' | saw format-hook`.
2. Run `echo '{}' | saw gate`: it blocks.
3. Run `echo '{}' | saw gate` again: it blocks again.

`gate` (`cli/src/task.ts:208-214`) never removes `.saw/untasked-edits`; only `startTask` does. Within one stop the `stop_hook_active` retry passes, but every later turn's Stop is blocked until a task is opened, so the "blocks once" description isn't true. That may be intended (it nags until routed), but it means a session that edits something without routing blocks on every reply. Decide which is intended, then either clear the marker after the first block or update the docs.

**B2 – an unknown `verify.<tier>.extends` silently drops every check.** Config: `[verify.complex]` with `extends = "nonexistent"` (any value that isn't a tier), in any layer. Results:
- `saw doctor` says `ok`.
- `saw task start --tier complex` prints `checks: none`.
- `gate` lets the stop through, and `task end` closes the task as **Verified**.

`critical` (which extends `complex`) loses the inherited standard checks the same way. `requiredChecks` (`cli/src/task.ts:98`) treats an unknown parent as empty, and `validate` doesn't check `extends`. Since this weakens verification, a committed `workflow.toml` could use it to switch off the gate for complex and critical work.

**B3 – the team and strict profiles in the docs produce invalid TOML when applied as written.** Config: `docs/reference/profiles.md` team or strict, pasted into a `workflow.toml` created by `saw init`. That file already has an `[autonomy]` table (`level = "propose"`), so pasting adds a second one and every command fails with `saw: settings unreadable (Cannot redefine key 'level'); fix the TOML file`. That covers doctor, config, task, gate, guard and the other hooks. The hooks swallow the error and print nothing, so they effectively fail open. The profile settings work once merged. Either tell readers to merge into the existing tables, or have `saw init` not write `[autonomy]`.

**B4 – `logging.level = "debug"` never logs a format-hook run.** Config: `logging.level = "debug"`, with `checks.format` set in the project or local layer, or not set at all. The docs say debug adds format-hook runs (`cli/src/defaults.ts`, the `logging` comment). But the `format` event is logged only when `formatHook` returns output (`cli/src/main.ts:473`), which happens only when the format command *fails*, and only when `checks.format` comes from a trusted layer (`cli/src/run.ts:88`). A successful run, or no format check, produces no debug event, so debug and info logs come out the same.

## Notes (not saw bugs)

- `routing.default_tier = "auto"` with no `--tier` gives `--tier is required`. That's by design, and every other default_tier value was picked up correctly.
- With `features.audit=false`, `--playbook audit` is refused as expected.
- Bun's TOML parser silently drops anything written on the same line after a table header (`[autonomy]\nlevel = …` written literally). That's a Bun quirk: saw can't see it, and other malformed TOML is reported correctly.
- `session-hook` printed nothing for a first `saw task start --unit feature` call, which is correct: it only steps in when a session that already finished a unit starts another.

## Matrix

| config | doctor | config | tiers | default_tier | guard | context-nudge | untasked-gate | repeat-block | session-hook | style-check | context-usage | dashboard | events |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `agents.enabled=["claude", "codex"]` | ✓ | ✓¹ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `audit.auditors=[]` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `audit.token_budget=50000` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `audit.triggers=[]` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.add_dependency="allow"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.add_dependency="ask"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.add_dependency="never"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.add_dependency="propose"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.commit="allow"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.commit="ask"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.commit="never"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.commit="propose"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.edit_global="allow"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.edit_global="ask"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.edit_global="never"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.edit_global="propose"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.open_pr="allow"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.open_pr="ask"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.open_pr="never"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.open_pr="propose"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.push="allow"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.push="ask"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.push="never"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.push="propose"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.self_improve="allow"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.self_improve="ask"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.self_improve="never"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.self_improve="propose"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.spawn_sessions="allow"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.spawn_sessions="ask"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.spawn_sessions="never"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.actions.spawn_sessions="propose"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.level="act"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.level="propose"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autonomy.level="suggest"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autopilot.enabled=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autopilot.enabled=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autopilot.max_failures=1` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autopilot.max_total_usd=15` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autopilot.max_wait="1h"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autopilot.per_item_usd=3` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autopilot.queue="docs/plans/q2.md"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autopilot.resume_on_limit=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `autopilot.resume_on_limit=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `context.agents_md_max_lines=50` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `context.claude_md_max_lines=100` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `context.handoff_at=0.5` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `context.suggest_compact_at=[0.3]` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `context.window_tokens=100000` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `dashboard.events_limit=25` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `dashboard.obsidian_note="docs/metrics.md"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `dashboard.output=".saw/d2.html"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `dashboard.panels=["outcomes", "events"]` | ✓ | ✓¹ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `dashboard.port=2087` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `defaults` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `deps.allowed_licences=[]` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `deps.lock="deps2.lock.toml"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `evals.baseline="evals/b2.json"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `evals.max_token_increase=0.5` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `evals.runs=2` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.audit=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.audit=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.brag=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.brag=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.budgets=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.budgets=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.code_review=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.code_review=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.compact_nudge=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.compact_nudge=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.dashboard=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.dashboard=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.docs_step=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.docs_step=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.format_hook=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.format_hook=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.grilling=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.grilling=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.metrics=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.metrics=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.obsidian=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.obsidian=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.parallel_sessions=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.parallel_sessions=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.retro=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.retro=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.security_review=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.security_review=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.style_hook=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.style_hook=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.tdd=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.tdd=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.trail=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.trail=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.unslop=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.unslop=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.verify_hook=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | no | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.verify_hook=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.worktrees=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `features.worktrees=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `invalid enum logging.level=loud` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓³ | ✓³ | B1 | ✓³ | ✓³ | ✓³ | ✓ | ✓ |
| `knowledge.store="both"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `knowledge.store="repo"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `knowledge.store="vault"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `knowledge.vault_path="<sandbox>/vault"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `logging.enabled=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `logging.enabled=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `logging.level="debug"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✗B4 |
| `logging.level="info"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `logging.level="warn"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.cheap="sonnet"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.mid="opus"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.mode="routed"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.mode="single"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.roles.architect="cheap"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.roles.architect="mid"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.roles.architect="strong"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.roles.explore="cheap"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.roles.explore="mid"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.roles.explore="strong"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.roles.implement="cheap"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.roles.implement="mid"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.roles.implement="strong"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.roles.research="cheap"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.roles.research="mid"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.roles.research="strong"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.roles.review="cheap"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.roles.review="mid"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.roles.review="strong"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.roles.security_review="cheap"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.roles.security_review="mid"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.roles.security_review="strong"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.roles.ui_verify="cheap"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.roles.ui_verify="mid"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.roles.ui_verify="strong"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `models.strong="haiku"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `output.full_logs=".saw/logs2"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `output.max_lines=30` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `output.quiet=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `output.quiet=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `output.rewrite_commands=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `output.rewrite_commands=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `playbook:audit` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `playbook:audit with features.audit=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `playbook:debug` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `playbook:design` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `playbook:feature` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `playbook:foundation` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `playbook:hardening` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `playbook:integration` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `playbook:spike` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `profile:autopilot` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `profile:solo` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `profile:strict` | ✗B3 | ✗B3 | ✗B3 | ✗B3 | ✗B3 | ✗B3 | ✗B3 | ✗B3 | ✗B3 | ✗B3 | ✗B3 | ✗B3 | ✗B3 |
| `profile:team` | ✗B3 | ✗B3 | ✗B3 | ✗B3 | ✗B3 | ✗B3 | ✗B3 | ✗B3 | ✗B3 | ✗B3 | ✗B3 | ✗B3 | ✗B3 |
| `project.type="api"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `project.type="cli"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `project.type="infra"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `project.type="lib"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `project.type="web"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `release.names=["SomeName"]` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.enabled=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.enabled=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.labels=[]` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.merge.auto_merge=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.merge.auto_merge=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.merge.delete_branch_on_merge=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.merge.delete_branch_on_merge=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.merge.merge_commit=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.merge.merge_commit=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.merge.rebase=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.merge.rebase=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.merge.squash=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.merge.squash=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.protect.block_force_push=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.protect.block_force_push=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.protect.branch="trunk"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.protect.require_pr=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.protect.require_pr=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.protect.required_approvals=1` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.protect.required_checks=["test"]` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.security.dependabot_alerts=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.security.dependabot_alerts=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.security.dependabot_fixes=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.security.dependabot_fixes=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.security.push_protection=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.security.push_protection=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.security.secret_scanning=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `repo.security.secret_scanning=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `retro.proposals_dir="docs/props"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `retro.repeat_threshold=1` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `review_session.budget_by_tier.complex=40000` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `review_session.budget_by_tier.critical=75000` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `review_session.budget_by_tier.standard=20000` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `review_session.budget_by_tier.trivial=1000` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `review_session.enabled=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `review_session.enabled=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `review_session.mode="audit"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `review_session.mode="both"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `review_session.mode="grill"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `review_session.when=[]` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `routing.always_grill=["standard"]` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `routing.default_tier="auto"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `routing.default_tier="complex"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `routing.default_tier="critical"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `routing.default_tier="standard"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `routing.default_tier="trivial"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `safety.deny=["rm -rf", "git push --force", "git push -f", "curl | sh", "terraform destroy"]` | ✓ | ✓¹ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `safety.deploy_approval=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `safety.deploy_approval=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `safety.destructive_approval=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `safety.destructive_approval=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `safety.no_secrets=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `safety.no_secrets=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `safety.push="allow"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `safety.push="ask"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `safety.push="never"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `scope:global autonomy.actions.commit=allow (loosen)` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `scope:global features.verify_hook=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | no | ✓ | ✓ | ✓ | ✓ | ✓ |
| `scope:global tokens.mode=hard` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `scope:local autonomy.actions.commit=allow (loosen)` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `scope:local features.verify_hook=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | no | ✓ | ✓ | ✓ | ✓ | ✓ |
| `scope:local tokens.mode=hard` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `scope:precedence global<project<local style.max_words` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `scope:project autonomy.actions.commit=allow (loosen)` | ✓⁴ | ✓ | ✓ | ✓ | ✓ | ✓³ | ✓³ | B1 | ✓³ | ✓³ | ✓³ | ✓ | ✓ |
| `scope:project features.verify_hook=false` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | no | ✓ | ✓ | ✓ | ✓ | ✓ |
| `scope:project tokens.mode=hard` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `sessions.mode="hard"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `sessions.mode="soft"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `sessions.new_per=[]` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `style.by_tier.complex=1000` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `style.by_tier.critical=300` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `style.by_tier.standard=1000` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `style.by_tier.trivial=40` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `style.max_words=125` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `style.mode="hard"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `style.mode="soft"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `style.tone="detailed"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `style.tone="normal"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `style.tone="structured"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `style.tone="verbose"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `tokens.budget.complex=300000` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `tokens.budget.critical=500000` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `tokens.budget.standard=75000` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `tokens.budget.trivial=10000` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `tokens.mode="hard"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `tokens.mode="soft"` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `tokens.warn_at=0.5` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `unknown key features.nope=true` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓³ | ✓³ | B1 | ✓³ | ✓³ | ✓³ | ✓ | ✓ |
| `verify.complex.extends="x"` | ✓ | ✓ | ✗B2 | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `verify.complex.run=["x"]` | ✓ | ✓ | ≈² | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `verify.critical.extends="x"` | ✓ | ✓ | ✗B2 | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `verify.critical.run=[]` | ✓ | ✓ | ≈² | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `verify.standard.run=[]` | ✓ | ✓ | ≈² | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |
| `verify.trivial.run=[]` | ✓ | ✓ | ≈² | ✓ | ✓ | ✓ | ✓ | B1 | ✓ | ✓ | ✓ | ✓ | ✓ |

## Plugin re-run

2026-11-01, on `feat/phase-13-autopilot` at ec25b94, in a new session with the `sams-agentic-workflow` plugin (0.1.0) installed at user scope from the local marketplace. B1–B4 were re-run in fresh sandboxes (`git init`, `bun init -y`, `saw init`, `checks.test = "bun --version"`), each with its own `SAW_HOME`, `HOME` and `USERPROFILE`. The real `~/.saw/config.toml` was not touched.

| check | result | evidence |
| --- | --- | --- |
| B1: gate blocks once per untasked edit | ✓ pass | after `format-hook`, the 1st `gate` blocks and the 2nd allows; a new edit makes `gate` block again |
| B2: unknown `verify.complex.extends` is rejected | ✓ pass | `doctor` exits 1 with `warning: project: "verify.complex.extends" must be one of trivial, standard, complex, critical (ignored)`; a complex task's `gate` still blocks on its checks |
| B4: debug logs a format-hook run, no `checks.format` | ✓ pass | `{"level":"debug","kind":"format","message":"format-hook ran"}` |
| B4: debug logs a format-hook run, `checks.format` set and passing | ✓ pass | same event |
| B3: team profile, merged per `profiles.md` | ✓ pass | `doctor` ok (exit 0); `autonomy.level = "propose"  # project`; guard denies a forced push |
| B3: strict profile, merged per `profiles.md` | ✓ pass | `doctor` ok (exit 0); `autonomy.level = "suggest"  # project`; guard denies a forced push |
| doctor: plugin enabled | ✓ pass | `plugin: ok`, `saw doctor: ok`, exit 0 |
| doctor: plugin installed but disabled (`claude plugin disable`) | ✓ pass | `problem: Claude Code plugin sams-agentic-workflow is installed but disabled: claude plugin enable sams-agentic-workflow@sams-agentic-workflow`, exit 1. Re-enabled afterwards; `doctor` is back to ok |
| live: guard (PreToolUse) | ✓ pass | fired on this session's own Bash calls; `.saw/events.jsonl` logged `guard.deny` for `rm -rf`, a forced push and `push is set to never`, plus `guard.ask` entries |
| live: context nudge (UserPromptSubmit) | – not run | silent in this repo, which is correct: the repo has no `workflow.toml`, so `isSawProject` is false. A sandbox session was not possible (see the last row) |
| live: format-hook (PostToolUse) and gate (Stop) | – not run | same reason: both are no-ops outside a saw project |
| live: sandbox session via `claude -p` | – blocked | the saw guard in this session denied it with `features.parallel_sessions is off: no new sessions`. I didn't work around the deny |

### Found during the re-run

- **B5 (candidate): guard deny patterns match inside quoted arguments.** A `claude -p` prompt that mentions a forced push, and `echo` of that text into a file, are both denied as on the `safety.deny` list, though neither runs a push. That errs on the safe side, but it blocks harmless commands and stopped the live-session test from starting with an inline prompt.
- **B6 (candidate): writing to any `workflow.toml` triggers the settings ask.** Appending to a sandbox's `workflow.toml`, a file outside this repo, logged `guard.ask: changing workflow settings that guard the agent needs your approval`. The check looks at the file name, not at whether the path is this project's settings file.
- **Note:** one guard call can log several events: `push is set to never` and `"rm -rf" is on the safety.deny list` share a timestamp, from one command.

To finish the live hook check, run a headless `claude -p` session yourself, from a terminal and not inside an agent session, in a saw sandbox with a temp `SAW_HOME`, `logging.level = "debug"` and a prompt that edits a file and tries a forced push. Then look in that sandbox's `.saw/events.jsonl` for `format`, `guard.deny` and `gate.block` entries.

## Real-project run

aws-security-lab (Python/FastAPI + OpenTofu), branch `test/saw-e2e` from `feat/stage-10d-scenarios-opentofu`, Windows 11, 2026-11-01. `saw init` then `saw doctor` (ok, plugin ok). `logging.level = "debug"` set in `workflow.local.toml` and globally. `[checks]` added by hand (format, lint, test). Hooks were driven by headless `claude -p` sessions run inside the repo (`features.parallel_sessions` now on globally). Nothing committed.

| Check | Result | Evidence (`.saw/events.jsonl`) |
| --- | --- | --- |
| `saw init` / `saw doctor` | pass | 18 files installed, `.gitignore` updated, CLAUDE.md kept with an `@AGENTS.md` hint |
| `guard.*` on Bash | pass (deny only) | `guard.deny` for a recursive force delete of a missing dir (×3 retries). Allowed calls log nothing, even at debug |
| `guard.*` on Edit | not observed | Edits are allowed, and allow decisions aren't logged, so there is no event to check |
| `format` after an edit | partial | `format: format-hook ran` after each Edit. With `checks.format` only in `workflow.toml` (untrusted layer) the hook runs nothing but logs the same message |
| Context nudge, no task open | pass | `UserPromptSubmit says: saw: no task open…` in the stream-json. No event is written |
| `gate.block`, untasked edit, once per edit | pass | One `gate.block` per run, each after one untasked edit |
| `tool.fail` on a failed command | pass | `Bash failed: ls does-not-exist-dir .` and a failed `saw task start` |
| `hook.error` with invalid `workflow.toml` | pass (after a second try) | `hook.error` from context, style-check and gate on `bad = `. File restored |
| Task flow: start, edit, `saw run`, end | pass after fixes | `tier` → `check test fail` → pass → `task end` Verified, metrics row with rework 2 |

### Found during the real-project run

- **B7 (candidate): an unclosed table header passes as valid TOML.** Appending `[broken` to `workflow.toml` leaves `saw config get` exiting 0 and every hook running as normal, so `hook.error` never fires. `bad = ` is rejected as expected.
- **B8 (candidate): checks run under cmd.exe on Windows.** `DATABASE_PROVIDER=memory uv run pytest` fails with `'DATABASE_PROVIDER' is not recognized`. A POSIX-style `checks.*` line in a committed `workflow.toml` can't work on both Windows and CI. The workaround was a `set X=..&&` form in `workflow.local.toml`.
- **B9 (candidate): allowed guard decisions aren't logged at debug.** `guard.*` shows up only for deny, ask or rewrite, so "the guard ran on this Edit" can't be confirmed from events.
- **B10 (candidate): the format event doesn't say when it skipped.** `format-hook ran` is logged at debug even when `checks.format` comes from the project layer and is skipped by the `TRUSTED_LAYERS` rule. Neither doctor nor init says that the committed `checks.format` won't run on edits.
- **B11 (candidate): the router nudge isn't logged.** It fires on each prompt with no task open but writes no event.
- **B12 (candidate): deny matching still hits quoted data after the B5 fix (84e193f).** In the driving session, a Bash call with a deny-listed pattern inside a double-quoted `claude -p "…"` argument was denied, and so was a heredoc whose body only mentioned it. File-fed prompts avoid it.
- **B13 (candidate): `saw init` guessed `project.type = "web"`** for a repo that is a FastAPI backend plus OpenTofu (`api` or `infra` fits better).
- **Note:** an invalid `--playbook fix` gives a clear error listing the valid playbooks. The repo isn't `ruff format`-clean (25 files), so `checks.format` uses `ruff check` locally.
- **B14: tests read the real `~/.saw/config.toml`.** With `review_session.enabled = true` and `features.obsidian = false` set globally, `review-session.test.ts` and `metrics.test.ts` fail. Fixed: `bunfig.toml` (root and `cli/`) preloads `cli/test/setup.ts`, which points `SAW_HOME` at an empty temp dir. 147/147 pass from both directories with the real global config in place.

### Fixes (B7–B13)

Tests in `cli/test/real-project.test.ts`. 147/147 pass with an empty `SAW_HOME`.

- **B7:** `parseToml` rejects a line outside a multi-line value that opens with `[` but isn't a whole header. Live: `[broken` now logs `hook.error … line 19: bad table header`.
- **B8:** checks run with `sh -c` on Windows when `sh` is on PATH (Git Bash), and fall back to `cmd /c`. Live: the committed `DATABASE_PROVIDER=memory uv run pytest -q` passes with no local override.
- **B9:** an allowed guard call logs `guard.allow` at debug, with the tool and target.
- **B10:** the `format` event says `format-hook skipped: …` (no command, or one from the untrusted project layer), or `format-hook ran: checks.format passed`.
- **B11:** the router nudge logs a `nudge` event at debug.
- **B12:** read-only commands (`cd`, `ls`, `cat`, `head`, `tail`, `wc`, `sort`, `uniq`, `cut`) count as data-only neighbours. A `cat`/`tee` heredoc with a quoted delimiter that isn't piped or chained has its body blanked. Piped heredocs, unquoted delimiters and a shell on the line still deny.
- **B13:** `saw init` guesses `project.type` from manifests up to two levels down: server framework → `api`, frontend → `web`, package.json `bin` → `cli`, only `*.tf` → `infra`. It prints the guess. aws-security-lab → `api`.
