# Feature reference

What the workflow does, grouped by job. Each feature names the settings that control it; [configuration.md](../how-to/configuration.md) explains how to set them, and `saw config show --resolved` lists every key with its current value.

The workflow has two halves:
- **The Claude Code plugin**: skills (`router`, `saw-settings`, `retro-promote`), playbooks, review agents and hooks. It shapes what the agent does.
- **`saw`**: a dependency-free TypeScript CLI run with bun. It holds the settings, records evidence and enforces the rules mechanically through hooks, so they don't depend on the agent remembering them.

## Task routing

Every task starts with the `router` skill. It classifies the task into a **tier** and a **playbook**, says both in one line, and opens it with `saw task start --tier <t> --playbook <p>`, which prints the steps and the checks the tier requires.

| Tier | For | Path |
|---|---|---|
| trivial | typos, one-liners | do it, run the tests |
| standard | a normal change | plan → tdd → checks → code and security review |
| complex | design choices, many files | grilling → research → options → ADR → approval → staged plan |
| critical | auth, payments, migrations, infra | complex + e2e, dependency audit, threat model, rollback plan |

Playbooks: `foundation` (new project), `feature`, `debug`, `design` (UI), `integration` (external services, schemas, infra), `spike` (answer a question with throwaway code), `hardening`, `audit`. The router switches to `debug` when the same check fails twice.

Settings: `[routing]` (`default_tier`, `always_grill`), `features.grilling`, `features.tdd`, `features.trail`, `features.worktrees`, `features.parallel_sessions`. You can override per task by saying `tier=critical`, `playbook=spike`, `tone=...` or `max_words=...`.

## Verification and the gate

A task isn't done until its checks pass.
- `saw run <check>` runs `checks.<check>` quietly, keeps the full log in `output.full_logs`, and records the result. `--changed` runs only the tests for changed files.
- `saw task record <check> pass|fail --note "..."` records a judgement check (code review, threat model).
- `saw task status` shows which required checks passed, failed or are missing.
- The **gate** (a Stop hook) blocks the agent from saying "done" until the tier's checks pass. The result is labelled Verified, Partially verified, Not verified or Blocked. If files were edited while no task was open, it blocks once and asks for the router and `saw task start` (or `saw task adhoc`, a trivial task for a one-off edit), so skipping routing doesn't skip verification.
- With no task open, the **context** hook adds a one-line reminder to each prompt to use the router skill. Both only apply in a project with `workflow.toml`, and both are off when `features.verify_hook` is false.
- `saw task report` writes the verification section for a PR (`--post` comments it, if `autonomy.actions.open_pr` allows).

Settings: `[checks]` (your commands), `[verify]` (which checks each tier needs; tiers can `extends` another), `features.verify_hook`, `features.code_review`, `features.security_review`, `features.format_hook` (runs `checks.format` after each edit, from your own settings layers only).

## Reviews

- **Review agents**: `code-reviewer`, `security-reviewer`, `arch-reviewer` (designs before approval), `ui-verifier` (real browser, mobile and desktop) and `researcher` (read-only, cited). Each runs on the model `[models]` assigns its role.
- **Independent review session** (`[review_session]`, off by default): before the PR of a feature, phase or stage, `saw review-session run` starts a fresh, read-only session that hasn't seen the builder's reasoning. It grills the work against its plan and audits it for holes. The session hook blocks `gh pr create` until a review newer than the last commit is recorded.
- **Auditors** (`[audit]`): whole-project audit skills run on the triggers you list (a tier or playbook), each with a token budget.

## Safety and autonomy

The `guard` hook checks every shell command and file edit before it runs.
- `[safety]`: a deny-list (`rm -rf`, force pushes, piping a download into a shell, plus your own), `push`, and approvals for destructive and deploy commands. Spellings are normalised, so `git -C . push` or `rm -r -f` can't slip past.
- `safety.no_secrets`: no reading or copying `.env` files into the session (`.env.example` is fine).
- `[autonomy]`: `level` (suggest, propose, act) and per action (`commit`, `push`, `open_pr`, `add_dependency`, `spawn_sessions`, `edit_global`, `self_improve`): `never`, `ask` or `allow`.
- A committed `workflow.toml` may only **tighten** `safety`, `autonomy` and the session toggles, so a cloned repo can't unlock commits or global edits. Loosen them in your own layers.
- The agent can't quietly change its own guardrails: `saw config set` on those keys, or an edit to a `workflow*.toml`, asks you first.

## Context, tokens and replies

- **Context nudges** (`[context]`): suggests `/compact` as the context window fills and a handoff near the end. `saw lint-context` keeps `AGENTS.md` and `CLAUDE.md` under their line limits.
- **Token budgets** (`[tokens]`): a budget per tier, a warning at `warn_at`, and in `hard` mode a stop at a safe point.
- **Models** (`[models]`): `routed` gives each agent role a cheap, mid or strong model (written into the agent files by `saw sync`); `single` makes them all use the session's model.
- **Quiet output** (`[output]`): failures show only their tail; `rewrite_commands` turns a raw check command into `saw run <check>`.
- **Reply style** (`[style]`): tone (normal, structured, detailed, verbose) and a word cap per tier, checked by a Stop hook (`soft` warns, `hard` asks for a rewrite).
- **Finding code**: Trail (`features.trail`) when installed, otherwise `saw outline <file>` for signatures with line numbers.

## Sessions

One session per unit of work (`[sessions]`): after a session finishes a phase, stage or feature (a commit or PR), starting the next one in the same session gets a warning (`soft`) or is blocked until a handoff is written (`hard`). `prompts/handoff.md` and `prompts/resume.md` carry work across sessions.

## Docs and launch

- **Implementer** (`features.implementer`, off): on standard-or-higher tasks the session writes the plan and reviews; the `implementer` agent writes each unit's code and tests on the model `models.roles.implement` names (strong by default; set it to `cheap` or `mid` to save tokens). It never commits, pushes or adds dependencies.
- **Docs step** (`features.docs_step`, on): `feature` and `foundation` tasks end by updating the docs with `engineering:documentation`, sorted into the Diátaxis split: `docs/tutorials/`, `docs/how-to/`, `docs/reference/`, `docs/explanation/` (the skeleton `saw init` creates). `AGENTS.md`, `CLAUDE.md` and skill files are written with `mattpocock-skills:writing-for-agents`. It's a required check, not a suggestion: `docs` is in `verify.standard.run` (so complex and critical inherit it), and the gate blocks until `saw task record docs pass --note "<files changed>"` (or `--note "none needed: <why>"`). Other playbooks (debug, design, audit, ...) don't owe it. `engineering:documentation` comes from Anthropic's `engineering` plugin, a dependency of saw's that's pinned in `deps.lock.toml`; `saw doctor` reports it if it's missing or disabled. With the feature off, the check is dropped and `saw sync` denies the skill.
- **Launch video** (`features.brag`, off): after a `feature` or `foundation` PR merges, the agent offers a short launch video with the pinned [brag](https://github.com/latent-spaces/brag) skill. It needs Hyperframes and its skills ([install.md](../how-to/install.md)); the bundled music is CC BY 4.0 by Sascha Ende and needs crediting.

## Profile and recommendations

- **About-me profile** (`features.about_me`, on): a Markdown file of ~50 questions in six groups (role, goals, how the agent should work, quality bar, tools, communication). `saw about-me [--scope global|project|local]` creates it from `templates/about-me.md`; the `about-me` skill fills it in by interview, or you edit it by hand. Files: `~/.saw/about-me.md` (global), `docs/about-me.md` (project, committed, keep it team-safe) and `.saw/about-me.local.md` (yours only). A project or local answer replaces the global answer to the same question. The SessionStart hook adds the merged answers to the session's context; `saw about-me show` prints what it adds.
- **MCP and skill suggestions** (`features.recommend`, on): `recommendations.toml` lists 10 MCP servers (GitHub, Figma, Context7, Playwright, Chrome DevTools, Sentry, Linear, Notion, Supabase, Fetch) and 10 skill plugins (frontend-design, figma, example-skills, document-skills, code-review, security-guidance, commit-commands, pr-review-toolkit, feature-dev, playwright). When a prompt mentions something one of them covers and it isn't installed, the UserPromptSubmit hook tells the agent, once per session. `recommend.mode = "auto"` has the agent offer to set it up and run `saw recommend add <id>` when you agree; `"manual"` only shows the install command. `recommend.mcp` and `recommend.skills` turn either half off. `saw recommend list` shows each entry's status; `saw recommend add <id> [--scope global|project|local] [--dry-run]` runs `claude mcp add` or `claude plugin install`; `saw recommend dismiss <id>` stops suggesting it in this project. No tokens are stored: servers that need sign-in ask through `/mcp`.
- **Figma fallback** (with `features.recommend`): when a Figma MCP call fails on a rate or plan limit, the failure hook tells the agent to carry on in the built-in browser and to use `extract-design-system` to match a live site. The design playbook says the same.
- **Skill finder** (`features.skill_finder`, on): `saw task end` lists up to 3 catalog skills that fit the task's playbook and changed files and aren't installed, using the same `recommend.mode`. `saw skills find` runs it on demand.

## ECC

- **ECC** (`features.ecc`, off): references the pinned [ECC](https://github.com/affaan-m/ECC) plugin by Affaan Mustafa (MIT). With it on, the `/compact` nudge from `[context]` names `ecc:strategic-compact` to choose the boundary and the focus, the router points at `ecc:context-budget` when skills, agents or MCP servers crowd the window, and `feature` and `foundation` tasks get an `ecc:verification-loop` step before the PR. saw's own nudge still decides *when* (`context.suggest_compact_at`); ECC's skill decides *where and what to keep*. `saw doctor` warns when the flag is on and no `ecc@…` plugin is installed, or when it is installed at a commit other than the pin. saw sync doesn't deny ECC skills when the flag is off: ECC is a whole plugin you installed yourself, and the flag only controls what saw refers to.
- **ECC hooks saw turns off**: ECC ships hooks on every event. Three overlap saw: GateGuard's Fact-Forcing Gate (`pre:bash:gateguard-fact-force`, `pre:powershell:gateguard-fact-force`, `pre:edit-write:gateguard-fact-force`) blocks the first Bash, PowerShell, Edit and Write call on each file until facts are restated, alongside `saw guard` on the same commands; `pre:edit-write:suggest-compact` repeats saw's context nudge on its own tool-count and token thresholds; `stop:format-typecheck` runs formatters and type checks for up to 300 s on every Stop, beside saw's Stop gate. Install steps are in [install.md](../how-to/install.md#4-optional-extras). ECC's other hooks (block-no-verify, config-protection, the PreCompact state save) don't conflict and can stay.

## Knowledge

`saw init` gives each project a `docs/` vault: `decisions/` (ADRs), `learnings/`, `plans/`, `features/`, `proposals/`, a glossary and conventions. It's plain Markdown with Obsidian-style links.
- `saw memory lint` finds learnings and ADRs that point at files that no longer exist, duplicate learnings, and files over the size limits.
- `saw vault sync` (`[knowledge]`, `features.obsidian`) indexes the project and its learnings in a central personal vault.

## Metrics and self-improvement

- `saw task end` appends the task's outcome, failed checks, rework, duration and tokens to `.saw/metrics.jsonl`.
- `saw dashboard` (`[dashboard]`) writes a static HTML page (and optionally a Markdown note): outcomes, first-pass rate, failures by check, rework, tokens per task, promotion effect, autopilot.
- `saw retro` (`[retro]`) turns a check that fails in `repeat_threshold` or more tasks into a proposal; the `retro-promote` skill turns it into one enforceable fix with an eval case. It also prints settings the evidence supports, as `saw config set` commands for you to review and run (never applied): a tier's token budget when `repeat_threshold`+ tasks went over it (the median overrun, rounded up), and `features.tdd` when `test` keeps failing with it off.
- `saw eval` (`[evals]`) runs the eval suite in `evals/` with `claude plugin eval` and compares it with a saved baseline; `--save-baseline` records the first one.

## Other agents

`AGENTS.md` is the shared instruction file; `CLAUDE.md` imports it. `saw init --agents codex,cursor,gemini` adds adapters for Cursor and Gemini CLI (Codex reads `AGENTS.md` natively), and `saw agents check` verifies each enabled agent will read it.

## GitHub settings as code

`[repo]` (off by default) declares merge options, branch protection, security features and labels. `saw repo plan` shows the diff against the live repo; `saw repo apply --yes` applies it and re-reads to verify. It never changes visibility or deletes anything.

## Third-party skills

`deps.lock.toml` pins each third-party skill to a commit, with its licence and reviewer. `saw deps verify` checks licences against `deps.allowed_licences` (`--strict` also fails on unreviewed pins); `saw deps diff` gives the compare URL to review an update; `saw deps pin ... --reviewed-by <you>` records it. `saw sync` denies the skills of features you turned off.

## Going public

`saw sanitize` scans every file a push would publish for secrets, home-folder paths, email addresses and your own names (git user, OS user, `release.names`). `--history` scans every line any commit ever added, because a secret that was committed and later deleted still goes public with the history. Mark a line that is meant to stay with `saw-sanitize: allow`, or list public literals in `.sanitize-allow`.

## Autopilot

`saw autopilot` works through the approved items in a queue on its own: one fresh headless Claude session, one branch and one PR per item. Off by default (`autopilot.enabled`), because it spends money unattended.

The queue (`autopilot.queue`, default `docs/plans/queue.md`) is a Markdown list you own:

```markdown
- [approved] csv-export: CSV export on the reports page
- [approved] dark-mode: dark theme following the OS setting
- [proposed] audit-log: proposed by the agent; waits for you
```

Only `approved` items run. The runner never approves, never edits the queue, never merges, never pushes to the base branch and never deploys (merging and pushes to main are also blocked at the tool level). For each item it:
1. checks the stops (below) and that the working tree is clean
2. creates `autopilot/<slug>` from the base branch (`repo.protect.branch`, default `main`)
3. runs `claude -p` with the router, under `autopilot.per_item_usd`
4. if the session ends `Blocked:` or `Not verified:`, parks the item and moves on; otherwise the item is finished and waits for your review. The session only commits. The runner then pushes that one branch and opens its PR with `gh`, but only when `autonomy.actions.open_pr`, `autonomy.actions.push` and `safety.push` are all `"allow"`; otherwise the branch waits for you to open the PR.

When a run hits a usage limit, the state is saved to `.saw/autopilot.json`, the runner sleeps until the reset time in the error (or backs off from 15 minutes, doubling, up to `autopilot.max_wait`), then resumes the same session (`resume_on_limit`). Restarting the runner continues where it stopped.

It stops on: an empty queue, `max_total_usd` spent, `max_failures` items failing in a row, a weakened `[safety]` setting (other than `safety.push`, which is how it opens PRs), or a `.saw/STOP` file. Each item and wait goes to `.saw/metrics.jsonl` and the dashboard's autopilot panel.

```bash
saw autopilot status               # what's next, what's done, what would stop it
saw autopilot --once               # run one item
saw autopilot                      # run until a stop
saw autopilot --install-schedule   # print the Task Scheduler / cron line (doesn't register it)
```

Check your Claude plan's terms before running it unattended on a subscription; API billing with `per_item_usd` and `max_total_usd` caps is the predictable option.

## Commands

`saw help` lists every command with its flags. The hooks (`guard`, `gate`, `context`, `format-hook`, `session-hook`, `style-check`) are run by Claude Code; `saw doctor --hooks` runs each once to check them. Plain `saw doctor` also runs `claude plugin list` and reports the plugin if it's missing or disabled (`--no-plugin` or `SAW_NO_PLUGIN=1` skips this; it's skipped when `claude` isn't on PATH).
