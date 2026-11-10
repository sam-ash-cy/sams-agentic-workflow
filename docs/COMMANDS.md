# Commands and settings

Every `saw` command, every setting, and recipes for common goals. `saw help` prints the same command list. Install and setup are in the [README](../README.md); agent-driven setup is in [STARTUP.md](STARTUP.md).

Contents: [Setup](#setup) · [Configuration commands](#configuration-commands) · [Tasks and verification](#tasks-and-verification) · [Reviews](#reviews) · [Metrics and self-improvement](#metrics-and-self-improvement) · [Knowledge and context](#knowledge-and-context) · [Supply chain and release](#supply-chain-and-release) · [GitHub](#github) · [Autopilot](#autopilot) · [Hooks](#hooks) · [Scopes](#scopes) · [Configuration keys](#configuration-keys) · [Optional extras](#optional-extras) · [Recipes](#recipes) · [Profiles](#profiles)

Global flag on every command: `--set key=value` overrides a setting for that call only (repeatable).

## Setup

| Command | What it does |
|---|---|
| `saw init [--dry-run] [--force] [--type <t>] [--hooks] [--agents a,b] [--repo [o/n]]` | Adds `workflow.toml`, `AGENTS.md`, `CLAUDE.md`, a CI workflow, a pre-commit hook file and the `docs/` vault; gitignores `workflow.local.toml` and `.saw/`; sets `checks.dep_audit` from your lockfiles. Keeps existing files unless `--force` (backs them up). |
| `saw init --upgrade [--dry-run]` | Updates template files you haven't edited; lists edited ones as `kept (edited)`. |
| `saw uninstall [--dry-run]` | Removes template files you haven't edited. |
| `saw doctor [--hooks] [--no-plugin]` | Checks settings (unknown keys, bad values, weakened guardrails), the environment and the plugin install (`claude plugin list`). `--hooks` runs each plugin hook once; `--no-plugin` or `SAW_NO_PLUGIN=1` skips the plugin check. |
| `saw sync [--plugin-dir <dir>] [--dry-run] [--session]` | Writes `.saw/resolved.json`, sets each agent's `model:` and `effort:` from `[models]`, and denies the skills of features you turned off. `--session` also writes the plan phase's `model` (`opusplan` when plan is opus and implement is sonnet) and `effortLevel` into `.claude/settings.local.json`, which takes effect on the next start. Run after changing features or models. |
| `saw agents check` | Checks that each agent in `agents.enabled` will read `AGENTS.md`. |

`saw init` flags: `--type web|api|cli|lib|infra` sets `project.type`; `--hooks` points `core.hooksPath` at `.githooks` (won't replace another hook manager without `--force`); `--agents codex,cursor,gemini` adds adapters for Cursor and Gemini CLI (Codex reads `AGENTS.md` natively); `--repo` prints what `saw repo apply` would change (read-only).

```bash
saw init --dry-run --type api --agents codex,cursor
saw init --upgrade --dry-run
saw doctor --hooks
```

## Configuration commands

| Command | What it does |
|---|---|
| `saw config show [--resolved] [--layers [--json]]` | Keys that are set and the layer each came from; `--resolved` lists every key with its value; `--layers` lists every key with its value in the global, project and local layers. |
| `saw docs status [--json]` | Each project doc: `blank` (still the template), `filled` or `missing`, and whether the repo has code. |
| `saw docs refresh` | Prints the brief for filling or updating the docs from the code (used by `/workflow-setup`). |
| `saw config get <key>` | One key, or a table (`saw config get verify.standard`). |
| `saw config set <key> <value> [--scope global\|project\|local]` | Validates and writes one key, keeping the file's comments. Default scope: project. Lists are JSON. There is no dry run: it writes. |
| `saw config unset <key> [--scope ...]` | Removes a key from that layer. |
| `saw explain <key>` | The value in every layer, which one won, and why one was ignored. |
| `saw profile list` | The profiles in [Profiles](#profiles). |
| `saw profile show <name>` | What a profile sets, per layer. |
| `saw profile apply <name> [--dry-run]` | Merges a profile key by key into the layers it names. Safe to run twice. |
| `saw style` | The effective reply style for the open task (tone, word cap). |

```bash
saw config set agents.enabled '["claude","codex"]'
saw config set style.tone structured --scope global
saw explain autonomy.actions.commit
saw profile apply team --dry-run
```

You can also ask Claude: the `saw-settings` skill asks what you want, picks the layer and runs these commands.

## Tasks and verification

The `router` skill runs most of these for the agent.

| Command | What it does |
|---|---|
| `saw task start --tier <t> --playbook <p> [--tone <t>] [--max-words <n>] [--unit phase\|stage\|feature --unit-id <name>]` | Opens a task and prints its steps and required checks. Tiers: `trivial`, `standard`, `complex`, `critical`. Playbooks: `foundation`, `feature`, `debug`, `design`, `integration`, `spike`, `hardening`, `audit`. |
| `saw task adhoc [--playbook <p>]` | A trivial task for a one-off edit. |
| `saw task phase plan\|implement\|review` | Marks the task's phase. With `features.implementer` on, the main session can't edit source in `implement`. |
| `saw task status` | Which required checks passed, failed or are missing. |
| `saw task record <check> pass\|fail [--note "..."] [--report <file>]` | Records a judgement check (`code_review`, `security_review`, `docs`, `threat_model`, ...). `--report` names a reviewer's report under `.saw/reviews/` (see `verify.require_review_evidence`). |
| `saw task report [--post [--pr <n>] [--yes]]` | The Markdown verification section for a PR; `--post` comments it with `gh`, as `autonomy.actions.open_pr` allows. |
| `saw task pr-body [--base <ref>]` | A whole PR description: the commits since `<ref>` (default `origin/<branch.base>`, else `origin/main`) and the verification section. Pipe it to `gh pr create --body-file -`. |
| `saw task end [--tokens <n>]` | Closes the task and appends its metrics to `.saw/metrics.jsonl`. |
| `saw resume` | Restores the task a stopped session left: the Stop hook writes `.saw/handoff.json` (open task, branch, latest plan, checks passed); `saw resume` reopens the task in the new session and switches back to its branch when the tree is clean. |
| `saw run <check> [--changed]` | Runs `checks.<check>` quietly, keeps the full log in `output.full_logs`, records the result. `--changed`: only tests for changed files. Failing test names (bun, jest/vitest, pytest, go, phpunit) go to `.saw/failures.jsonl`; a test that also failed in an earlier task is flagged as recurring. |
| `saw outline <file>` | Signatures with line numbers (when Trail isn't used). |

Tiers and what they require by default:

| Tier | For | Required checks (`[verify]`) |
|---|---|---|
| trivial | typos, one-liners | `test` |
| standard | a normal change | `format`, `lint`, `typecheck`, `test`, `code_review`, `security_review`, `docs` |
| complex | design choices, many files | standard (plus grilling, research, options, ADR, staged plan) |
| critical | auth, payments, migrations, infra | complex + `e2e`, `dep_audit`, `threat_model`, `rollback_plan` |

Checks with no `checks.<name>` command are recorded with `saw task record`. The gate labels the result Verified, Partially verified, Not verified or Blocked. Override the router per message with `tier=`, `playbook=`, `tone=` or `max_words=`.

```bash
saw task start --tier standard --playbook feature
saw run test --changed
saw task record code_review pass --note "no findings"
saw task record docs pass --note "README.md install section"
saw task status
saw task end
```

## Reviews

| Command | What it does |
|---|---|
| `saw review-session brief` | Prints the brief a reviewer session gets. |
| `saw review-session run [--dry-run]` | Starts a fresh read-only Claude session that grills the unit against its plan and audits it (`review_session.mode`). Records a signed result. Needs `review_session.enabled`. |
| `saw review-session record <file> --unit <kind> --unit-id <name>` | Records a review you ran yourself. Doesn't satisfy `require_review_evidence = "review_session"`. |

Review agents in the plugin: `code-reviewer`, `security-reviewer`, `arch-reviewer`, `ui-verifier`, `researcher`, `implementer`. Each runs on the model `models.roles` gives its role; in `routed` mode `saw guard` denies a call to one on a different model.

`verify.require_review_evidence = "review_session"` accepts only a `saw review-session run` that saw started, signed with an HMAC keyed by `~/.saw/review-key` (created on first use, never committed). That stops casual forging from the session, not a determined agent with an unrestricted shell; for a review nobody in the session can touch, run it in CI.

## Metrics and self-improvement

| Command | What it does |
|---|---|
| `saw dashboard [--serve [--port <n>]]` | Writes the static metrics page (`dashboard.output`) and the Markdown note if `dashboard.obsidian_note` is set. `--serve`: a live page on 127.0.0.1. |
| `saw retro [--dry-run]` | A proposal in `retro.proposals_dir` for each check failing in `repeat_threshold`+ tasks, plus suggested `saw config set` commands (never applied). A single test failing in `repeat_threshold`+ tasks (from `.saw/failures.jsonl`) gets a `test: <name>` proposal of its own. |
| `saw eval [--case <glob>] [--runs <n>] [--dry-run] [--save-baseline]` | Runs `evals/` with `claude plugin eval` and compares with the baseline. Spends tokens. |
| `saw eval compare <before.json> <after.json>` | Compares two saved results. |

The `retro-promote` skill turns a proposal into one enforceable fix with an eval case. The repo's `docker-compose.yml` serves the dashboard from a container if you'd rather not install bun.

## Knowledge and context

| Command | What it does |
|---|---|
| `saw vault sync [--dry-run]` | Indexes this project and its learnings in the central vault (`knowledge.vault_path`). |
| `saw memory lint` | Stale file references in `docs/learnings` and `docs/decisions`, duplicate learnings, size limits. |
| `saw lint-context` | `AGENTS.md` / `CLAUDE.md` against `context.*_max_lines`. |

`prompts/handoff.md` and `prompts/resume.md` carry work across sessions.

## Profile and recommendations

| Command | What it does |
|---|---|
| `saw about-me [--scope global\|project\|local] [--dry-run]` | Creates the about-me profile (~50 questions in six groups) from `templates/about-me.md`. Global `~/.saw/about-me.md`, project `docs/about-me.md` (committed, keep it team-safe), local `.saw/about-me.local.md`. Fill it in with the `about-me` skill or by hand; a project or local answer replaces the global one. |
| `saw about-me show` | The merged profile the SessionStart hook adds to each session (as preferences, never as commands). |
| `saw recommend list` | The 10 MCP servers and 10 skill plugins in `recommendations.toml`, each marked installed, dismissed or available. |
| `saw recommend add <id> [--scope global\|project\|local] [--dry-run]` | Runs `claude mcp add` or `claude plugin install` (adding the marketplace first when needed). No tokens are stored; servers that need sign-in use `/mcp`. |
| `saw recommend dismiss <id>` | Stops suggesting it in this project. |
| `saw skills find` | Catalog skills that fit the open task's playbook and changed files (what `saw task end` prints). |

When a prompt mentions something a missing catalog entry covers, the UserPromptSubmit hook suggests it once per session. `recommend.mode = "auto"` has the agent offer to run `saw recommend add`; `"manual"` only shows the install command. When a Figma MCP call hits a rate or plan limit, the failure hook tells the agent to carry on in the built-in browser and use `extract-design-system` to match a live site.

## Supply chain and release

| Command | What it does |
|---|---|
| `saw deps list` | Pinned third-party skills in `deps.lock.toml`. |
| `saw deps verify [--strict]` | Licences against `deps.allowed_licences`; `--strict` also fails on unreviewed pins. |
| `saw deps diff <name> <sha>` | The compare URL to review before moving a pin. |
| `saw deps pin <name> <sha> --reviewed-by <who>` | Moves a pin and records the reviewer. |
| `saw split <plan.md> [--dry-run]` | Splits an approved plan into parallel worktrees: each heading that names a branch in backticks (``## Docs `docs/cost` ``) gets a worktree beside the repo, on that branch off `origin/<branch.base>`, with its section and the plan's shared context in `.saw/brief.md`. Prints the `claude` command to start each session; existing paths are left alone. |
| `saw release [patch\|minor\|major\|<x.y.z>] [--pre <id>] [--dry-run] [--all] [--allow-branch]` | Maintainers. Bumps the version in `package.json` (the source of truth), `.claude-plugin/plugin.json`, the marketplace entry and every `mods/*/.claude-plugin/plugin.json`; prepends a `CHANGELOG.md` section built from Conventional Commit titles since the last tag (breaking, features, fixes; `--all` adds the rest); commits `chore(release): vX.Y.Z` and makes an annotated tag. With `release.flow = "release-branch"` it doesn't tag; `saw release tag` tags `main` after the merge. With no bump it suggests one from the commits (before 1.0 a breaking change is minor); the first release tags the current version. `--pre beta` makes `-beta.0`, `-beta.1`…; a plain release after that finalises and folds the beta sections in. Refuses on a dirty tree, an existing tag, version drift, or a branch other than `main` (with `release.flow = "release-branch"`: other than `release/vX.Y.Z`, matching the version, or `hotfix/*`) (`--allow-branch` overrides). **Never pushes**: run `git push origin main --follow-tags`. In the release-branch flow, after the merge, `saw release tag` on `main` makes the annotated `vX.Y.Z` tag from its CHANGELOG section (refusing off `main`, on drift, or with no section); pushing the tag runs `.github/workflows/release.yml` verifies on every OS, publishes the GitHub Release and fast-forwards the `beta` (every tag) and `stable` (final releases) branches. |
| `saw release notes <tag>` / `saw release verify <tag>` | One version's changelog section; check a tag matches every manifest. Used by the release workflow. |
| `saw sanitize [--history]` | Secrets, home paths, emails and your names (git user, OS user, `release.names`) in files a push would publish; `--history` scans every commit. Allow a line with `saw-sanitize: allow`, or list literals in `.sanitize-allow`. |

**Release-branch flow (opt-in, `release.flow = "release-branch"`; this repo uses it).** `main` only moves when something ships; the `merge-source` CI job fails any PR into `main` that isn't from `release/vX.Y.Z` or `hotfix/<desc>`.

1. **Start a version:** cut `release/vX.Y.Z` from `main` and push it.
2. **Work:** branch `feat/…`, `fix/…` or `docs/…` from the open `release/vX.Y.Z` (not `main`, so you build on what's already in the release), and open the PR into `release/vX.Y.Z`. CI must pass; merge with squash or rebase (linear history).
3. **Ship:** on `release/vX.Y.Z`, run `saw release` (bumps every manifest, writes `CHANGELOG.md`, commits) and push. Open a PR from `release/vX.Y.Z` into `main` and merge it (squash or rebase; `main` keeps linear history) once CI is green.
4. **Tag:** on an up-to-date `main`, run `saw release tag`, then `git push origin vX.Y.Z`. The tag push runs `.github/workflows/release.yml`, which publishes the GitHub Release and moves `stable`.
5. **Hotfix:** branch `hotfix/<desc>` from `main`, run `saw release` on it, PR it into `main`, tag `main` as in step 4, then merge `main` into any open release branch.

Rulesets for `main` and `release/**` are in `.github/rulesets/`: import them in Settings → Rules → Rulesets, or run `gh api -X POST repos/<owner>/<repo>/rulesets --input .github/rulesets/main.json` (and again with `release.json`).

## GitHub

| Command | What it does |
|---|---|
| `saw repo plan [--repo o/n]` | The diff between `[repo]` and the live GitHub settings. |
| `saw repo apply [--repo o/n] --yes` | Applies it and re-reads to verify. Needs `repo.enabled`. Never changes visibility or deletes anything. |

## Autopilot

| Command | What it does |
|---|---|
| `saw autopilot status` | What's next, what's done, what would stop it. |
| `saw autopilot [--dry-run] [--once]` | Works through `[approved]` items in `autopilot.queue`: one headless `claude -p` session, branch `autopilot/<slug>` and PR each. `--once`: one item. |
| `saw autopilot --install-schedule` | Prints the Task Scheduler / cron line (doesn't register it). |

The queue is a Markdown list you own; only `approved` items run:

```markdown
- [approved] csv-export: CSV export on the reports page
- [proposed] audit-log: waits for you
```

The runner never approves items, edits the queue, merges, pushes to the base branch or deploys. It pushes an item's branch and opens its PR only when `autonomy.actions.open_pr`, `autonomy.actions.push` and `safety.push` are all `allow`. It stops on an empty queue, `max_total_usd` spent, `max_failures` in a row, a weakened `[safety]` setting (other than `safety.push`), or a `.saw/STOP` file. On a usage limit it saves state to `.saw/autopilot.json`, waits (up to `max_wait`) and resumes. Check your Claude plan's terms before running it unattended; API billing with the USD caps is the predictable option.

## Hooks

Claude Code runs these from the plugin's `hooks/hooks.json`; you don't call them yourself. `saw doctor --hooks` runs each once.

| Command | Event | What it does |
|---|---|---|
| `saw guard` | PreToolUse | Enforces `[safety]` and `[autonomy]` on shell commands and edits, and `models.roles` on saw agent calls. |
| `saw gate` | Stop | Blocks "done" until the tier's checks pass; blocks once if files changed with no task open. |
| `saw context` | UserPromptSubmit | `/compact` and handoff nudges, token-budget warnings, a router reminder when no task is open, MCP/skill suggestions. |
| `saw format-hook` | PostToolUse | Runs `checks.format` after each edit. |
| `saw session-hook` | PreToolUse | One session per unit (`[sessions]`); blocks `gh pr create` until a review session is recorded when `[review_session]` is on. |
| `saw failure-hook` | PostToolUseFailure | Logs failed tool calls to the event log; on a Figma MCP limit, points the agent at the browser. |
| `saw session-start` | SessionStart | Warns when the session's model isn't `models.roles.plan`; adds the about-me profile to the context. |
| `saw style-check` | Stop | Warns (`soft`) or asks for a rewrite (`hard`) when a reply is over the word cap. |

## Scopes

| Scope | File | `--scope` | Committed | Put here |
|---|---|---|---|---|
| default | built in | n/a | n/a | nothing; every key has one |
| global | `~/.saw/config.toml` (`$SAW_HOME`) | `global` | no | your preferences everywhere: style, vault path, names, Trail |
| project | `workflow.toml` | `project` (default) | yes | the team's checks, tiers, reviews, and guardrails that tighten |
| local | `workflow.local.toml` | `local` | no | your loosened guardrails and experiments for this repo |

Later layers win; `--set` beats all of them for one call. From `workflow.toml`, guarded keys (`safety.*`, `autonomy.*`, `features.worktrees`, `features.parallel_sessions`, `verify.require_review_evidence`) are ignored when they loosen the default, and `safety.deny` entries are added, never removed. `knowledge.vault_path` and `release.names` are ignored from `workflow.toml`. `features.format_hook` only runs a `checks.format` command from your own layers.

## Configuration keys

**G** = guarded (tighten-only from `workflow.toml`), **P** = personal (global or local only).

### `[features]`

| Key | Default | Purpose |
|---|---|---|
| `features.grilling` | `true` | Clarifying questions before complex work. |
| `features.tdd` | `true` | Test-first step in task steps. With `tdd.mode = "hard"` (default) and a `[checks].test` command, saw guard denies code edits (test files excepted) on standard-or-higher tasks in `tdd.playbooks` (default feature, foundation, integration, debug) until `saw run test` has failed since the task started. `"soft"`: the step only. |
| `features.code_review` | `true` | `code_review` in `[verify]`; off drops it. |
| `features.security_review` | `true` | `security_review` in `[verify]`; off drops it. |
| `features.verify_hook` | `true` | The gate and the no-task router reminder. |
| `features.budgets` | `true` | Token budget warnings per tier. |
| `features.compact_nudge` | `true` | `/compact` and handoff nudges. |
| `features.style_hook` | `true` | The reply word-cap check. |
| `features.format_hook` | `true` | Run `checks.format` after each edit. |
| `features.trail` | `false` | Add the Trail lookup step to tasks. Needs Trail installed. |
| `features.obsidian` | `true` | `saw vault sync` into the central vault. |
| `features.metrics` | `true` | Per-task metrics in `.saw/metrics.jsonl`. |
| `features.dashboard` | `true` | `saw dashboard`. |
| `features.retro` | `true` | `saw retro`. |
| `features.branch_guard` | `true` | Never work on `branch.base`: `saw task start` creates `<type>/<slug>` off `origin/<branch.base>` (or a worktree), and saw guard denies commits there and edits during a non-trivial task. |
| `branch.base` | `"main"` | The branch to branch off (global or project layer). |
| `branch.mode` | `"auto"` | `branch`, `worktree`, or `auto` (a worktree for complex and critical tasks when `features.worktrees` is on, a branch otherwise). |
| `features.advisor` | `true` | Turns on Claude Code's built-in advisor (`saw sync` writes `advisorModel`); standard-or-higher tasks owe an `advisor` check (`saw task record advisor pass`) before the PR. |
| `advisor.model` | `"claude-opus-5-5"` | The model the advisor asks (global or project layer), e.g. `claude-fable-5-2` for critical work. |
| `features.task_skills` | `true` | `saw task start` names the skills in `task_skills.<playbook>` (plus `task_skills.plan` on complex and critical tasks) and how to install missing ones. |
| `features.audit` | `true` | Run `[audit]` auditors on their triggers. |
| `features.worktrees` | `true` | Suggest a worktree per complex task; off denies `git worktree add` / `claude -p`. **G** |
| `features.parallel_sessions` | `false` | Allow splitting a task into sessions. **G** |
| `features.unslop` | `false` | unslop polish step in the design playbook. |
| `features.brag` | `false` | Offer a launch video after feature/foundation PRs merge. |
| `features.ecc` | `false` | Point nudges and playbooks at ECC skills. |
| `features.docs_step` | `true` | Feature and foundation tasks end with a `docs` check. |
| `features.living_docs` | `true` | `saw task end` flags docs still blank in a project with code, and command/config/API changes without a `docs/reference/` change; debug, integration and hardening tasks get a reference-docs step. |
| `pre_pr.skills` | `[]` | Skills that must run before a PR, e.g. `["security-review", "simplify"]`. Each becomes a required check `skill:<name>` on `pre_pr.tiers` (default standard, complex, critical): record it with `saw task record skill:<name> pass`, or the task stays unverified. |
| `features.implementer` | `false` | Standard+ tasks: the session plans and reviews, the `implementer` agent writes code. |
| `features.about_me` | `true` | SessionStart adds the merged about-me profile to the context. |
| `features.recommend` | `true` | Suggest missing MCP servers and skills when a prompt needs them; Figma limit fallback. |
| `features.skill_finder` | `true` | `saw task end` suggests up to 3 skills that fit the finished task. |

`[recommend]`: `mode` (`auto` \| `manual`, default `auto`), `mcp` and `skills` (both `true`) turn either half off.

### `[project]`, `[routing]`, `[autonomy]`

| Key | Default | Purpose |
|---|---|---|
| `project.type` | `"web"` | `web`, `api`, `cli`, `lib`, `infra`. |
| `routing.default_tier` | `"auto"` | `auto` lets the router pick; or force a tier. |
| `routing.always_grill` | `["complex","critical"]` | Tiers that always get grilling. |
| `autonomy.level` | `"propose"` | `suggest` (never acts), `propose` (asks before outward-facing actions), `act`. **G** |
| `autonomy.actions.commit` | `"ask"` | `never`, `ask` or `allow`. **G** |
| `autonomy.actions.push` | `"never"` | **G** |
| `autonomy.actions.open_pr` | `"ask"` | **G** |
| `autonomy.actions.add_dependency` | `"ask"` | **G** |
| `autonomy.actions.self_improve` | `"propose"` | How `retro` changes are handled. **G** |
| `autonomy.actions.edit_global` | `"never"` | Edits under `~/.claude` and `~/.saw`. **G** |
| `autonomy.actions.spawn_sessions` | `"ask"` | Starting other sessions. **G** |

### `[tokens]`, `[models]`, `[context]`, `[output]`, `[style]`

| Key | Default | Purpose |
|---|---|---|
| `tokens.mode` | `"soft"` | `soft` warns at the budget; `hard` stops at a safe point. |
| `tokens.warn_at` | `0.8` | Share of the budget that triggers a warning. |
| `tokens.budget.<tier>` | `20000` / `150000` / `600000` / `1000000` | Budget for trivial / standard / complex / critical. |
| `models.mode` | `"routed"` | `routed`: model per role; `single`: every agent on the session's model. |
| `models.cheap` / `mid` / `strong` | `"haiku"` / `"sonnet"` / `"opus"` | Model names for each class. |
| `models.roles.<role>` | explore, research: `cheap`; implement, architect, security_review: `strong`; review, ui_verify: `mid` | Class (or model) per agent role. |
| `models.roles.plan` | unset | When set, SessionStart warns if the session runs another model. |
| `models.phases.<phase>.model` / `.effort` | unset | Per-phase model (class or name) and effort (`low`, `medium`, `high`, `xhigh`, `max`). Phases are the role names plus `plan`. Overrides `models.roles.<phase>`. |
| `models.phases.<phase>.<tier>.model` / `.effort` | unset | The same per tier (`trivial`, `standard`, `complex`, `critical`), for the open task's tier. |

What each part forces:
- **Subagents, model: hard.** `saw guard` denies a call on a model other than the phase/tier setting.
- **Subagents, effort: hard when Claude Code reads it.** `saw sync` writes the base effort into `effort:` frontmatter, and Claude Code applies it only if it supports that field. Tier effort overrides are not written, because one agent file can't vary by tier.
- **Main session (plan mode): a setting or a warning.** A hook can't switch the running model. `saw sync --session` sets `opusplan`, which runs plan mode on Opus and the rest on Sonnet, together with `effortLevel` for the next start. Any other pairing only gets a SessionStart warning.

```toml
[models.phases.plan]
model = "opus"
effort = "low"
[models.phases.implement]
model = "sonnet"
effort = "medium"
[models.phases.implement.critical]
model = "opus"
effort = "high"
```
| `context.agents_md_max_lines` | `100` | `saw lint-context` limit. |
| `context.claude_md_max_lines` | `200` | `saw lint-context` limit. |
| `context.window_tokens` | `200000` | Context window size for the nudges. |
| `context.suggest_compact_at` | `[0.5, 0.7]` | Shares of the window that suggest `/compact`. |
| `context.handoff_at` | `0.85` | Share that suggests a handoff. |
| `context.autocompact` | `"inherit"` | Claude Code's own auto-compact, written by `saw sync`: `inherit` leaves `autoCompactEnabled` alone, `on`/`off` set it. Global layer: `saw sync --scope global` writes `~/.claude/settings.json`; else `.claude/settings.local.json`. |
| `context.autocompact_window` | `0` | Tokens (100000-1000000) for `autoCompactWindow`; `0` leaves it alone. |
| `output.quiet` | `true` | Passing checks print nothing; failures print their tail. |
| `output.max_lines` | `60` | Tail length on failure. |
| `output.full_logs` | `".saw/logs"` | Where full logs go. |
| `output.rewrite_commands` | `false` | Run a raw `[checks]` command as `saw run <check>`. |
| `style.tone` | `"normal"` | `normal`, `structured`, `detailed`, `verbose`. |
| `style.max_words` | `250` | Prose word cap (code blocks don't count). |
| `style.by_tier.<tier>` | `80` / `0` / `0` / `600` | Cap per tier; `0` uses `max_words`. |
| `style.mode` | `"soft"` | `soft` warns; `hard` asks for a rewrite. |

### `[checks]`, `[verify]`

| Key | Default | Purpose |
|---|---|---|
| `checks.<name>` | none (`dep_audit` set by `saw init`) | Command for a mechanical check: `test`, `lint`, `typecheck`, `format`, `e2e`, `dep_audit`, or your own. |
| `verify.<tier>.run` | see [tiers](#tasks-and-verification) | Checks the tier requires. |
| `verify.<tier>.extends` | complex: `standard`; critical: `complex` | Inherit another tier's checks. |
| `verify.require_review_evidence` | `"off"` | `off`; `agent` (a reviewer report via `--report`, or a review session); `review_session` (only a signed `saw review-session run`). **G** |

### `[sessions]`, `[review_session]`, `[audit]`

| Key | Default | Purpose |
|---|---|---|
| `sessions.new_per` | `["phase","stage","feature"]` | Unit kinds that get their own session; `[]` = off. |
| `sessions.mode` | `"soft"` | `soft` warns; `hard` blocks until a handoff is written. |
| `review_session.enabled` | `false` | Independent review before a unit's PR. |
| `review_session.when` | `["feature","phase","stage"]` | Unit kinds reviewed. |
| `review_session.mode` | `"both"` | `grill`, `audit` or `both`. |
| `review_session.budget_by_tier.<tier>` | `0` / `40000` / `80000` / `150000` | Reviewer token budget; `0` skips the tier. |
| `audit.auditors` | `["appsec-review","dependency-audit-rules","web-quality-audit"]` | Skills to run; third-party ones must be pinned in `deps.lock.toml`. |
| `audit.triggers` | `["critical","hardening","audit"]` | Tiers or playbooks that trigger them. |
| `audit.token_budget` | `100000` | Budget per audit. |

### `[autopilot]`

| Key | Default | Purpose |
|---|---|---|
| `autopilot.enabled` | `false` | Opt in. Set in local. |
| `autopilot.queue` | `"docs/plans/queue.md"` | The queue file. |
| `autopilot.per_item_usd` | `5` | Cap per item. |
| `autopilot.max_total_usd` | `30` | Cap per run. |
| `autopilot.max_failures` | `2` | Consecutive failures before it stops. |
| `autopilot.max_wait` | `"6h"` | Longest wait on a usage limit. |
| `autopilot.resume_on_limit` | `true` | Resume the same session after a limit. |

### `[knowledge]`, `[release]`, `[agents]`, `[logging]`, `[dashboard]`

| Key | Default | Purpose |
|---|---|---|
| `knowledge.store` | `"repo"` | `repo`, `vault` or `both`. |
| `knowledge.vault_path` | `""` | Absolute path to your central vault. **P** |
| `release.names` | `[]` | Extra names of yours for `saw sanitize`. **P** |
| `release.flow` | `"main"` | `main`: `saw release` runs on `main` and tags. `release-branch`: cut on `release/vX.Y.Z` or `hotfix/*`, tag `main` after the merge with `saw release tag`. |
| `agents.enabled` | `["claude"]` | Agents checked by `saw agents check`: `claude`, `codex`, `cursor`, `gemini`. |
| `logging.enabled` | `true` | Event log in `.saw/events.jsonl`. |
| `logging.level` | `"info"` | `debug`, `info`, `warn`. |
| `dashboard.panels` | all eight | `outcomes`, `first_pass_rate`, `findings_by_category`, `rework`, `cost_per_task`, `promotion_effect`, `events`, `autopilot`. |
| `dashboard.port` | `4173` | `--serve` port on 127.0.0.1. |
| `dashboard.events_limit` | `50` | Events shown in the timeline. |
| `dashboard.output` | `".saw/dashboard.html"` | Static page path. |
| `dashboard.obsidian_note` | `""` | Also write the panels as Markdown here. |

### `[repo]`

| Key | Default | Purpose |
|---|---|---|
| `repo.enabled` | `false` | Allow `saw repo apply`. |
| `repo.merge.squash` / `merge_commit` / `rebase` | `true` / `false` / `false` | Allowed merge methods. |
| `repo.merge.delete_branch_on_merge` | `true` | |
| `repo.merge.auto_merge` | `false` | |
| `repo.protect.branch` | `"main"` | Protected branch, also the base for autopilot. |
| `repo.protect.require_pr` | `true` | |
| `repo.protect.required_approvals` | `1` | |
| `repo.protect.required_checks` | `[]` | Status checks required before merge. |
| `repo.protect.block_force_push` | `true` | |
| `repo.security.secret_scanning` / `push_protection` / `dependabot_alerts` / `dependabot_fixes` | `true` | |
| `repo.labels` | `["tier:trivial", ...]` | Labels to create. |

### `[retro]`, `[evals]`, `[deps]`, `[safety]`

| Key | Default | Purpose |
|---|---|---|
| `retro.repeat_threshold` | `2` | Failing tasks before a proposal. |
| `retro.proposals_dir` | `"docs/proposals"` | Where proposals go. |
| `evals.baseline` | `"evals/baseline.json"` | Saved baseline. |
| `evals.max_token_increase` | `0.1` | Allowed token growth against the baseline. |
| `evals.runs` | `3` | Runs per case. |
| `deps.lock` | `"deps.lock.toml"` | Pin file. |
| `deps.allowed_licences` | MIT, Apache-2.0, BSD-2/3-Clause, ISC, CC-BY-4.0 | Licences `saw deps verify` accepts. |
| `safety.push` | `"never"` | `never`, `ask`, `allow`. **G** |
| `safety.destructive_approval` | `true` | Ask before destructive commands. **G** |
| `safety.deploy_approval` | `true` | Ask before deploys. **G** |
| `safety.no_secrets` | `true` | No reading `.env` files into the session (`.env.example` is fine). **G** |
| `safety.deny` | `["rm -rf","git push --force","git push -f","curl \| sh"]` | Denied commands; spellings are normalised. Project entries are added. **G** |

Environment variables: `SAW_HOME` (moves `~/.saw`), `SAW_NO_PLUGIN` (skip plugin steps in bootstrap and doctor), `SAW_WITH_ECC` (bootstrap also installs ECC), `CLAUDE_CONFIG_DIR` (where bootstrap writes instead of `~/.claude`).

## Optional extras

Install the dependency first, then turn the flag on and run `saw sync`.

**Trail** (`features.trail`): see the [README](../README.md#trail-strongly-recommended).

**unslop** (`features.unslop`), at the pinned commit:

```bash
git clone https://github.com/heydamir/unslop ~/.claude/skills/unslop
git -C ~/.claude/skills/unslop checkout 1d13095e4bef6ad6c74f1dd828d84c4ba309a4dc
saw config set features.unslop true
saw sync
```

**brag** (`features.brag`). It renders with Hyperframes; its own instructions run `npx hyperframes` unpinned, so install a fixed version and prefer `bunx hyperframes@<version>`. Optional: `uv` and Python for beat analysis.

```bash
git clone https://github.com/latent-spaces/brag ~/.claude/brag-src
git -C ~/.claude/brag-src checkout 669ab9286aa28b6c3ee30e75f181ee74319d012a
cp -r ~/.claude/brag-src/skills/brag ~/.claude/brag-src/skills/brag-slim ~/.claude/skills/
saw config set features.brag true
saw sync
```

**agent-browser** (no flag). A browser CLI for the `ui-verifier` agent where the host has no browser tools: plain `claude` in a terminal, or CI. The agent uses it when it's on PATH. Pin a version:

```bash
bun add -g agent-browser@0.41.1
agent-browser install
```

`agent-browser install` downloads Chrome for Testing.

**ECC** (`features.ecc`), pinned in saw's marketplace (or `SAW_WITH_ECC=1` before the bootstrap):

```bash
claude plugin install ecc@sams-agentic-workflow
saw config set features.ecc true
saw doctor
```

Three ECC hooks duplicate saw's (GateGuard, its compact nudge, a Stop-time format/typecheck). Turn them off in the `env` block of `~/.claude/settings.json`; `saw doctor` warns while `ECC_GATEGUARD` isn't `off`:

```json
"env": {
  "ECC_GATEGUARD": "off",
  "ECC_DISABLED_HOOKS": "pre:edit-write:suggest-compact,stop:format-typecheck"
}
```

**GitHub settings**: `saw config set repo.enabled true`, review `saw repo plan`, then `saw repo apply --yes`.

### Mod: prompt-band

`mods/prompt-band/` draws a row above the prompt with Improve, Compact and Write handoff note buttons, and the spend: `$x task · $y session` while a saw task is open, `$y session` otherwise.

| Option | Default | Meaning |
| --- | --- | --- |
| `compactAtPct` | `50` | Context fill at which the Compact button appears |
| `budgetUsd` | `0` | Per-task budget: a toast at 80% and once past it, and the cost turns yellow then red. `0` shows the cost without warnings |

### Mod: secrets-redactor

`mods/secrets-redactor/` is a Claude Code mod that keeps secrets out of the model's context. Load it with `claude --plugin-dir mods/secrets-redactor`.

- **Redact.** Tool output is scanned for secrets, email addresses and IPv4 addresses. Each value is replaced with a placeholder such as `«SECRET_1»`, `«EMAIL_2»` or `«IP_3»`. The same value keeps the same placeholder for the whole session. Secrets covered: AWS, GitHub, Anthropic, OpenAI, Stripe and Slack keys and tokens, JWTs, private key blocks, passwords in connection strings, and random-looking `KEY=` / `token:` values. The placeholder map lives only in session state. The mod never logs it or writes it to disk.
- **Restore.** Placeholders in a tool call's input are swapped back for the real values before the tool runs, so commands and edits still work.
- **Guard.** A Write, Edit or MultiEdit that would hardcode a new secret is denied, and the model is told to use an environment variable and an `.env.example` placeholder instead. `.env` files are exempt. Every hit shows a toast and adds a note to the model's context.
- **False positives.** Git SHAs, hex digests, UUIDs, version numbers, loopback addresses, paths and plain words are left alone. A `KEY=` value has to look random (mixed character classes and high entropy) before it counts.

| Option | Default | Meaning |
| --- | --- | --- |
| `secrets` / `emails` / `ips` | `true` | Turn each category on or off |
| `allowlist` | example.com, noreply, `git@` | Comma-separated regexes. A value matching any of them is never redacted |
| `onSecret` | `redact` | `redact` hides secrets. `warn` flags them without hiding. `stop` hides them, then blocks tool calls and holds prompts until you send `!secrets-ok` (optionally followed by your prompt) |
| `blockHardcoded` | `true` | Deny edits that hardcode a secret |

An errored tool result is redacted too, and comes back to the model as a refusal. In `stop` mode, only a secret not seen earlier in the session halts work. Limitation: a placeholder restored into a tool call's input becomes the real value in the input the tool runs with, so the session transcript may store it there.

## Recipes

Mix freely. Anything that loosens a guardrail goes in `--scope local` or `--scope global`. Afterwards run `saw doctor`, and `saw sync` if you changed features or models. The four whole [profiles](#profiles) (`saw profile apply`) cover faster solo work, teams, maximum safety and automation.

**Everyday** (a new project, sensible defaults):

```bash
saw init
saw config set checks.test "bun test"
saw config set checks.lint "bun run lint"
saw config set checks.typecheck "bunx tsc --noEmit"
saw config set checks.format "bunx prettier --check ."
saw doctor --hooks
```

If a tier needs a check you don't have yet, remove it for this project: `saw config set verify.critical.run '["dep_audit","threat_model","rollback_plan"]'`.

**Faster development** (your own project; the gate still checks the work), or `saw profile apply solo`:

```bash
saw config set autonomy.actions.commit allow --scope local
saw config set features.grilling false --scope local
saw config set routing.always_grill '["critical"]' --scope local
saw config set style.tone structured --scope global
```

**Low tokens:**

```bash
saw config set models.mode routed
saw config set output.max_lines 30
saw config set output.rewrite_commands true
saw config set context.suggest_compact_at '[0.4,0.6]'
saw config set tokens.mode hard
saw config set style.max_words 150 --scope global
saw config set features.trail true --scope local       # with Trail installed
saw config set features.implementer true
saw config set models.roles.implement mid
saw config set sessions.mode hard
saw sync
```

Check the effect after a few tasks with `saw dashboard` (tokens per task by tier).

**Maximum safety**, or `saw profile apply strict` (all of these tighten, so they belong in `workflow.toml`):

```bash
saw config set autonomy.level suggest
saw config set tokens.mode hard
saw config set routing.always_grill '["standard","complex","critical"]'
saw config set review_session.enabled true
saw config set verify.require_review_evidence review_session
saw config set sessions.mode hard
saw config set safety.deny '["rm -rf","git push --force","git push -f","curl | sh","terraform destroy","kubectl delete"]'
```

**Stronger verification:**

```bash
saw config set verify.require_review_evidence agent
saw config set review_session.enabled true
saw config set models.roles.review strong
saw config set checks.e2e "bunx playwright test"
saw config set verify.standard.run '["format","lint","typecheck","test","e2e","code_review","security_review","docs"]'
```

**Team**, or `saw profile apply team`: commit `workflow.toml` with review sessions and `[repo]`; each developer loosens `commit` in their own `workflow.local.toml`.

```bash
saw config set review_session.enabled true
saw config set repo.enabled true
saw repo plan
saw init --agents codex,cursor,gemini
saw config set agents.enabled '["claude","codex","cursor","gemini"]'
saw agents check
```

Keep shared rules in `AGENTS.md` (every agent reads it) and Claude-only notes in `CLAUDE.md`.

**Parallel agents:**

```bash
saw config set features.worktrees true
saw config set features.parallel_sessions true --scope local
saw config set autonomy.actions.spawn_sessions ask --scope local
saw config set review_session.enabled true
saw config set review_session.mode both
saw sync
```

**Automated tasks**, or `saw profile apply autopilot`:

```bash
saw config set autopilot.enabled true --scope local
saw config set autonomy.actions.commit allow --scope local   # headless sessions can't answer "ask"
saw config set checks.format "bunx prettier --write ." --scope local
saw autopilot status
saw autopilot --once
```

To let it push branches and open PRs, also set `safety.push`, `autonomy.actions.push` and `autonomy.actions.open_pr` to `allow` with `--scope local`.

**UI and design** (install the skills first, see [Optional extras](#optional-extras)):

```bash
saw config set features.unslop true
saw config set features.brag true
saw sync
```

The `design` playbook uses the `ui-verifier` agent to check changes in a real browser at mobile and desktop widths. Outside the desktop app, install [agent-browser](#optional-extras) so it has one.

**Knowledge and Trail:**

```bash
saw config set features.trail true --scope local
saw config set knowledge.vault_path "/absolute/path/to/vault" --scope global
saw config set knowledge.store both
saw config set dashboard.obsidian_note docs/metrics.md
saw vault sync --dry-run
saw memory lint
```

## Profiles

`saw profile list`, `show` and `apply` read the sections below, so what you see here is what gets applied. Each block names the file it merges into. A profile that loosens guardrails puts those keys in `workflow.local.toml` or `~/.saw/config.toml`, because `workflow.toml` can only tighten them. Apply with `saw profile apply <name> --dry-run`, then without `--dry-run`, then `saw doctor`. Keys a profile leaves out keep their values. Don't paste a block whole into a file `saw init` wrote: TOML rejects a table defined twice.

## Solo: your own projects, moving fast

You're the only one committing, and you review your own PRs. The agent commits on its branch without asking; pushing, PRs and new dependencies still ask.

`workflow.local.toml` (or `~/.saw/config.toml` for every project):

```toml
[autonomy.actions]
commit = "allow"
add_dependency = "ask"
open_pr = "ask"

[features]
grilling = true          # still ask the questions on complex work
worktrees = true

[tokens]
mode = "soft"

[style]
tone = "normal"
max_words = 200
```

`workflow.toml` (committed):

```toml
[review_session]
enabled = false          # turn on for bigger features

[sessions]
mode = "soft"
```

## Team: a shared repo with PR review

Defaults that keep the team's history clean: the agent asks before committing, never pushes, and every unit gets an independent review before its PR.

`workflow.toml` (committed):

```toml
[autonomy]
level = "propose"

[autonomy.actions]
commit = "ask"
push = "never"
open_pr = "ask"
add_dependency = "ask"
spawn_sessions = "ask"

[review_session]
enabled = true
when = ["feature", "phase", "stage"]

[sessions]
mode = "soft"
new_per = ["phase", "stage", "feature"]

[repo]
enabled = true           # then: saw repo plan, saw repo apply --yes

[repo.protect]
branch = "main"
require_pr = true
required_approvals = 1
```

Each developer can still loosen `commit` in their own `workflow.local.toml`.

## Strict: critical systems, regulated code, or a repo you don't trust yet

Nothing outward-facing without a human, budgets enforced, every unit reviewed in its own session.

`workflow.toml` (committed; all of these tighten, so they apply):

```toml
[autonomy]
level = "suggest"        # the agent proposes; you run commits, pushes and PRs

[autonomy.actions]
commit = "never"
push = "never"
open_pr = "never"
add_dependency = "never"
spawn_sessions = "never"
edit_global = "never"

[features]
parallel_sessions = false
code_review = true
security_review = true

[routing]
always_grill = ["standard", "complex", "critical"]

[tokens]
mode = "hard"

[review_session]
enabled = true
mode = "both"

[verify]
require_review_evidence = "review_session"   # a review pass needs a saw review-session report

[sessions]
mode = "hard"

[safety]
deny = ["rm -rf", "git push --force", "git push -f", "curl | sh", "terraform destroy", "kubectl delete"]
```

Add to `[checks]` and `[verify]` whatever your compliance needs (e2e, `dep_audit`, a licence scan).

## Autopilot: an approved queue, unattended

For working through planned items overnight. Starts from Solo or Team; never merges whatever you set.

`workflow.local.toml` (yours: it spends your money):

```toml
[autopilot]
enabled = true
queue = "docs/plans/queue.md"
per_item_usd = 5
max_total_usd = 30
max_failures = 2
max_wait = "6h"
resume_on_limit = true

[autonomy.actions]
commit = "allow"         # headless sessions can't answer an "ask"
# To have the runner push each finished item's branch and open its PR, also
# uncomment these and safety.push below. Otherwise finished branches wait for you.
# open_pr = "allow"
# push = "allow"

[safety]
# push = "allow"
```

Then `saw autopilot status`, and `saw autopilot --once` for a first run you watch.
