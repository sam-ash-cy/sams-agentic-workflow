# Changelog

All notable changes to this project. Versions follow [Semantic Versioning](https://semver.org); entries are generated from Conventional Commits by `saw release`.

## [Unreleased]

### Features

- settings dashboard: `saw dashboard --serve` lists your projects (`saw projects`, `~/.saw/projects.json`) and edits every setting at the global, shared-project and only-me layers, switches mods on or off, and shows each project's statistics. Reached through a one-use launch address and a session cookie; writes also need the dashboard's origin and csrf key, and `saw guard` denies an agent talking to its API
- `saw projects list | add | remove`; `saw init` and `saw task start` register the folder they run in
- `isKnownKey` rejects `__proto__`, `constructor` and `prototype` segments, so `saw config set verify.__proto__.run` can no longer reach the prototype chain

### Removed

- ECC support: the optional ECC plugin, `features.ecc`, `SAW_WITH_ECC` and the doctor checks for it. A leftover `features.ecc` in your settings is ignored with a warning.

## [1.0.3] - 2026-11-11

### Fixes

- line the cost and task-state lines up with the button labels ([#76](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/76))

## [1.0.2] - 2026-11-11

### Features

- opt-in `verify.mode = "hard"`: holds commit, push and PR until the task is verified ([#70](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/70))
- opt-in `routing.mode = "hard"`: denies edits until a task is open ([#69](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/69))
- enforcement stage 3 (task state, adoption, preset, workspace init, subagents, auto-routing) ([#71](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/71))

### Fixes

- close the paths to Verified without verifying; a required check with no command now shows as Not verified ([#72](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/72))
- make hard routing and verify modes opt-in ([#73](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/73))

## [1.0.1] - 2026-11-10

### Features

- opt-in release-branch flow with `release.flow = "release-branch"` and `saw release tag` ([#67](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/67))
- ship through a release branch; only release and hotfix/* merge into main ([#64](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/64))

### Fixes

- tag releases on main after the release branch merges ([#65](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/65))
- clear plugin directory pattern holds ([#61](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/61))
- plugin directory review findings ([#60](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/60))
- give each hook its own entry file for the directory's exact bun command ([#59](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/59))
- pass the plugin directory's install-free launch checks ([#58](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/58))

### Other

- docs: privacy policy covers everything the plugin stores, reads and sends ([#63](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/63))
- docs: plugin listing URLs and privacy policy ([#62](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/62))
- docs: marketplace-ready README, full feature list and animated demo ([#57](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/57))
- docs: document the 1.0.0 features and settings ([#56](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/56))

## [1.0.0] - 2026-11-10

### Features

- session handoff and saw resume ([#46](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/46))
- advisor step with a configurable model ([#43](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/43))
- render mod based on prismantis ([#45](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/45))
- sync auto-compact settings from workflow.toml ([#47](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/47))
- clearer labels in the prompt band ([#48](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/48))
- tests-first guard for standard-or-higher tasks ([#50](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/50))
- saw task pr-body builds the PR description from commits and checks ([#52](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/52))
- cost band shows task and session spend, warns at a budget ([#51](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/51))
- recommend skills per task ([#49](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/49))
- saw split turns a plan's steps into parallel worktrees ([#53](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/53))
- failure memory tracks recurring failing tests across tasks ([#54](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/54))
- saw doctor reports each mod's install state ([#44](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/44))
- branch guard keeps work off the base branch ([#42](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/42))
- secrets-redactor mod ([#37](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/37))
- versioned releases with saw release, changelog and release workflow ([#38](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/38))
- pin model and effort per phase and tier ([#36](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/36))
- workflow mods with saw mods check and a setup step ([#39](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/39))
- /workflow-setup wizard, living docs, pre_pr.skills ([#34](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/34))
- about-me profile, MCP/skill recommendations, Figma fallback, skill finder ([#29](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/29))
- require_review_evidence, so a review pass needs a report from the task ([#26](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/26))
- enforce per-role models ([#25](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/25))
- docs as a required check, saw profile/explain/task adhoc, retro settings suggestions ([#24](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/24))
- implementer agent, plan in the session and implement on models.roles.implement ([#21](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/21))
- optional pinned ECC plugin integration (features.ecc)
- phase 13, autopilot queue runner, Diátaxis docs, brag and docs step
- unified event log, live dashboard server and optional compose
- phase 12, public release prep (saw sanitize, MIT licence, GETTING_STARTED, unslop pin)
- phase 11, independent audit session per unit of work ([review_session], saw review-session)
- phase 10, session per unit of work ([sessions], saw session-hook); roadmap adds Phase 11 audit session
- audit fixes round 3; command rewrite, skill denies via sync, sessions/worktrees guard, bootstrap scripts and global fragment, init --repo, eval --runs/--dry-run
- audit fixes; every setting acts, guard, budgets, repo settings as code
- phase 9 response style and length; [style] settings, saw style and style-check Stop hook, per-task tone/max-words, style evals; roadmap adds phase 10 session per unit of work
- phase 8 central vault sync and agent adapters
- phase 7 saw retro proposals, retro-promote skill, saw eval with baseline gate, eval cases, promotion_effect panel; context-usage compact nudges
- phase 6 metrics and static dashboard; prompts/ and debug escalation; ADR 0015 repo settings (proposed)
- phase 5 project template, docs vault, CI and pre-commit hook; init --type/--hooks
- phase 4 reviewer agents with model routing, pinned deps and saw deps; ADR 0014 autonomous runner (proposed)
- phase 3 router, playbooks, task/run/gate commands and Stop-hook verify gate
- phase 2 saw CLI core: layered settings, safety guard, config/doctor/init/sync

### Fixes

- pre-pr-gate runs saw through cmd /c when it can't spawn it directly ([#41](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/41))
- never let a missing companion or bad settings stop saw loading ([#40](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/40))
- drop exists-then-read on skill tracking file (CodeQL js/file-system-race) ([#33](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/33))
- resolve CodeQL file-system-race and comment-stripping alerts ([#32](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/32))
- let Claude Code write its plan and memory files; drop the per-prompt nudge banner ([#22](https://github.com/sam-ash-cy/sams-agentic-workflow/pull/22))
- real-project run bugs B7-B14
- only a leading ~ counts as home, so Windows short names don't ask
- log failed agent tool calls and hooks that can't read settings, reword a comment sanitize flagged
- ignore quoted data in deny matching, scope settings asks to this project
- gate blocks once per untasked edit, reject unknown verify extends, log every format-hook run, profiles say merge
- route untasked edits, check the plugin install in doctor, log autopilot steps as events
- bootstrap.ps1 compares content instead of Get-FileHash (not loaded on CI runners)
- sort template walk so init/upgrade output is stable across filesystems
- gate requires real runs for mechanical checks, skips unconfigured ones, survives a truncated check log
