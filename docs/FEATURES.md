# Features

Every feature below is a setting. Switch any of them on or off for all your projects, for one repo, or just for yourself in one repo.

| Layer | File | Committed | Use it for |
|---|---|---|---|
| default | built in (`cli/src/defaults.ts`) | n/a | every key has one |
| global | `~/.saw/config.toml` (`$SAW_HOME`) | no | your defaults for every project |
| project | `workflow.toml` | yes | the team's settings for this repo |
| local | `workflow.local.toml` | no (gitignored) | your settings for this repo |

Later layers win, and a per-command `--set key=value` overrides all four for that call. Guardrails (`safety.*`, `autonomy.*` and a few others) only tighten from `workflow.toml`, so a cloned repo can't loosen them on your machine. `saw explain <key>` shows which layer set a value and why another was ignored. Rules for each key: [COMMANDS.md](COMMANDS.md#configuration-keys).

```bash
saw config set features.tdd false --scope global      # every project
saw config set features.brag true                     # this repo, committed
saw config set features.budgets false --scope local   # just you, this repo
saw explain features.tdd
```

Defaults are what a fresh `saw init` gives you. "Key" is the setting that controls it. Optional extras need the external dependency installed first.

| Category | Feature | Default | Key | Needs |
|---|---|---|---|---|
| Routing | Tier + playbook per task, `saw task start` steps | on | `[routing]` | plugin |
| | Routing enforced (hard: edits wait for an open task; shell writes still hit the Stop gate; session start says when a repo has no `workflow.toml`) | off (`routing.mode = "hard"` or `enforcement = "strict"`) | `features.verify_hook`, `routing.mode` | |
| | Grilling (clarifying questions) on complex and critical | on | `features.grilling`, `routing.always_grill` | |
| | Branch guard: tasks branch (or worktree) off `main`; no commits on it | on | `features.branch_guard`, `[branch]` | |
| | Skills named per playbook at task start | on | `features.task_skills`, `[task_skills]` | the named plugins |
| | Test-first step (default soft: the step only; hard: code edits wait for a failing `saw run test`) | on | `features.tdd`, `tdd.mode` | |
| Verification | Mechanical checks, quiet output, full logs kept | on | `[checks]`, `[output]` | your commands |
| | Required checks per tier (tiers can `extends`) | on | `[verify]` | |
| | Gate: block "done" until checks pass | on | `features.verify_hook` | plugin |
| | Acceptance criteria: `saw task start --accept "<criterion>"` (repeatable) or `saw task accept add`; each is recorded as `accept:<n>` (a pass needs `--note`), and the task isn't Verified until all pass. Tasks without criteria are unchanged | on | `features.verify_hook` | |
| | Format after each edit | on (needs `checks.format`) | `features.format_hook` | |
| | Docs step on feature and foundation tasks | on | `features.docs_step` | `engineering` plugin (installed by bootstrap) |
| | Living docs: flag blank docs and reference drift at task end; docs step on debug/integration/hardening | on | `features.living_docs` | |
| | Review reports required for a review pass | off | `verify.require_review_evidence` | |
| | Verification enforced (hard: no commit, push or PR while the open task isn't Verified or is below its tier floor, or, with no task open, while the tree has changes no Verified task covers; `saw task retier` raises the tier) | off (`verify.mode = "hard"` or `enforcement = "strict"`) | `features.verify_hook`, `verify.mode`, `routing.trivial_max_files`, `routing.trivial_max_lines`, `routing.critical_paths` | |
| | Unconfigured checks: a required check with no `checks.<name>` command makes the task Not verified ("not configured"), unless listed in `verify.allow_unconfigured`; session start and `saw doctor` warn when no `checks.*` command is set | on | `checks.<name>`, `verify.allow_unconfigured` | |
| | Stale tasks (a task another session left open denies edits until `saw resume` or `saw task end`) and unverified exits (`saw task end --reason`, shown at the next session start) | on | `routing.mode` | |
| | Enforcement preset: `strict` sets the routing, verify, tdd, tokens, style and sessions modes hard, `relaxed` sets them soft, `custom` leaves each to its key (`saw config show --resolved` names the preset as the source) | custom | `enforcement` | |
| | Auto-routing by rules (no model call): with no task open, the router nudge proposes `saw task start --tier <t> --playbook <p>` (`suggest`), or saw opens a provisional task that holds commits until `saw task retier` or `saw task start` confirms it (`open`, the default; with `routing.mode = "soft"` an edit made with no task open also opens a provisional standard / feature task instead of a Stop block) | open | `routing.auto` | |
| | Subagent coverage: subagent edits and commands pass the same routing, verify and tier-floor guards; SubagentStop logs their edits against the open task, or arms the untasked-edit Stop check | on | `features.verify_hook` | |
| | Adoption report: tasks opened against Stops, Stops and prompts with no task, routing and verify denials, unverified exits, retiers, tier spread (`saw adoption`, and a dashboard card) | on | `dashboard.panels` (`adoption`) | |
| | Feature usage: trigger count per feature and mod, zero counts as candidates to cut, unmeasurable ones listed apart (`saw adoption --features`) | on | | |
| | Saw on vs off: the eval suite with and without saw's hooks, per-case and total pass rate, tokens and cost (`saw eval --ab`, `.saw/evals-ab.json`) | on | `evals.runs`, `evals.max_token_increase` | |
| Reviews | Code and security review on standard+ | on | `features.code_review`, `features.security_review` | |
| | Advisor consult on standard+ (Claude Code's advisor, Opus 5.5 by default) | on | `features.advisor`, `advisor.model` | |
| | PR description from commits and checks (`saw task pr-body`) | manual | | `gh` |
| | Review agents (code, security, architecture, UI, research) | on | `[models.roles]`, `[models.phases]` (model + effort per phase and tier) | plugin |
| | Independent read-only review session per unit | off | `[review_session]` | `claude` CLI |
| | Whole-project auditors on chosen triggers | on | `features.audit`, `[audit]` | auditor skills |
| Safety | Guard hook: deny-list, push, destructive and deploy approval, no secrets | on | `[safety]` | plugin |
| | Autonomy per action (commit, push, PR, deps, sessions, global edits) | propose / ask | `[autonomy]` | plugin |
| Context and tokens | Token budget per tier (`soft` warns, `hard` stops) | soft | `features.budgets`, `[tokens]` | |
| | `/compact` and handoff nudges | on | `features.compact_nudge`, `[context]` | |
| | Claude Code auto-compact set from settings | inherit | `context.autocompact`, `context.autocompact_window` | |
| | Task and session cost above the prompt, budget warnings, and the task state: "no task open" in a saw project, else tier, playbook and verification label (terminal `claude` only: mod bands and panes don't draw in the desktop app) | on | prompt-band `budgetUsd` | prompt-band mod |
| | Handoff card on stop, `saw resume` in the next session | on | | plugin |
| | Model per agent role | routed | `[models]` | |
| | Reply tone and word cap, checked on Stop | on | `features.style_hook`, `[style]` | |
| | Trail code map in task steps | off | `features.trail` | Trail CLI |
| Sessions | One session per phase, stage or feature | soft | `[sessions]` | |
| | Worktree per complex task | on | `features.worktrees` | |
| | Split a task across sessions | off | `features.parallel_sessions` | |
| | `saw split`: a plan's branch headings become parallel worktrees | manual | `branch.base` | |
| | Implementer agent writes planned units | off | `features.implementer` | |
| UI and launch | unslop UI polish in the design playbook | off | `features.unslop` | unslop skill |
| | Launch video after feature PRs | off | `features.brag` | brag skill, Hyperframes |
| Knowledge | `docs/` vault (decisions, learnings, plans, features) | on | `saw init` | |
| | Central personal vault index | on (needs `vault_path`) | `features.obsidian`, `[knowledge]` | |
| Metrics | Per-task metrics and event log | on | `features.metrics`, `[logging]` | |
| | Static or live dashboard | on | `features.dashboard`, `[dashboard]` | |
| | Retro proposals and settings suggestions | on | `features.retro`, `[retro]` | |
| | Failure memory: recurring failing tests flagged and proposed | on | `features.retro`, `retro.repeat_threshold` | |
| | Eval suite with baseline comparison | manual | `[evals]` | `claude` CLI |
| Agents | `AGENTS.md` for Codex, Cursor, Gemini CLI | claude only | `[agents]` | |
| GitHub | Repo settings as code (`saw repo plan/apply`) | off | `[repo]` | `gh` |
| Supply chain | Pinned third-party skills, licence check | on | `[deps]` | |
| Release | `saw sanitize` for secrets, paths, emails, names | manual | `[release]` | |
| | `saw release`: version bump, CHANGELOG from Conventional Commits, annotated tag | manual | `[release]` | |
| | Release-branch flow: cut on `release/vX.Y.Z` or `hotfix/*`, merge into `main`, then `saw release tag` | off (`main`) | `release.flow` | |
| Automation | Autopilot: approved queue, one headless session + PR per item | off | `[autopilot]` | `claude` CLI, `gh` |
| Automation | Autopilot chains: `needs:` dependencies stack on the previous item's branch; `auto_approve_tiers` runs trivial/standard `[proposed]` items | off (`[]`) | `autopilot.auto_approve_tiers` | autopilot |
| | Planner: `saw plan "<goal>"` writes ADR drafts, a roadmap and validated `[proposed]` queue items | manual | `[plan]` | `claude` CLI |

## Mods

Add-ons, each its own plugin in this marketplace: `claude plugin install <name>@sams-agentic-workflow`. The bootstrap and `/workflow-setup` install `dashboard-pane` for everyone, and `saw doctor` reports it missing as a problem. The rest are optional.

| Mod | What it does |
|---|---|
| `prompt-band` | buttons above the prompt (Improve, Plan first, Review, Ship check, Compact, Handoff) with usage limits |
| `workflow-pane` | a pane beside the chat: current tier, playbook, verification label and which checks passed or are missing; "no task open" in a saw project with none |
| `dashboard-pane` | **installed by default.** The settings dashboard in a pane beside the chat (`/dashboard-pane`): switch settings and mods and manage projects; starts its own local server and stops it when the pane closes |
| `render` | themed rendering of replies: tables, headings, code, mermaid, charts (based on prismantis, MIT) |
| `secrets-redactor` | hides secrets, emails and IPs in tool output behind placeholders; blocks hardcoded secrets in edits |
| `context-guard` | warns as context fills; past a limit, holds new prompts until you hand off |
| `context-saver` | trims long command output (full copy kept), skips repeat reads, steers compaction |
| `guardrail-hook` | blocks commits on auto-generated branch names and commit messages with AI attribution |
| `pre-pr-gate` | blocks `gh pr create` until the task's pre-PR skills are recorded |
| `trail-nudge` | reminds the model of the matching Trail command when it greps or reads source |

Ready-made profiles (`saw profile apply solo|team|strict|autopilot`) and goal recipes: [COMMANDS.md](COMMANDS.md#recipes).
