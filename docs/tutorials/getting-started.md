# Getting started

A walkthrough from a fresh machine to a first verified task. It takes about ten minutes.

## 1. Prerequisites
- [bun](https://bun.sh) 1.3 or later (`saw` is TypeScript run by bun; there are no npm dependencies).
- git, and [Claude Code](https://claude.com/claude-code) for the plugin. Codex, Cursor and Gemini CLI read the same `AGENTS.md` (step 4).
- Optional: the `gh` CLI, for `saw repo` and `saw task report --post`.

## 2. Install
Clone the repo, then run the bootstrap for your OS. Add `--dry-run` first to see each step; it never overwrites a file without backing it up.

```bash
git clone https://github.com/sam-ash-cy/sams-agentic-workflow.git
cd sams-agentic-workflow
sh bootstrap.sh --dry-run
sh bootstrap.sh
```

On Windows PowerShell: `.\bootstrap.ps1 -DryRun`, then `.\bootstrap.ps1`.

The bootstrap copies `global/CLAUDE.md` to `~/.claude/saw-workflow.md` and imports it from your `~/.claude/CLAUDE.md`, copies `global/settings.example.json` only if you have no `settings.json`, then installs the Claude Code plugin (and its pinned `mattpocock-skills` dependency) from this folder's marketplace.

The bootstrap doesn't touch your `PATH`. Put this folder's `bin/` on it yourself (or run `bun cli/src/main.ts` instead of `saw`); [docs/install.md](../how-to/install.md) shows how on each OS. Then check the setup:

```bash
saw doctor
```

## 3. Set up a project
In the project you want to work on:

```bash
saw init --dry-run
saw init
```

This adds `workflow.toml`, `AGENTS.md`, `CLAUDE.md`, the `docs/` vault and a CI workflow. Files you already have are kept.

## 4. Choose your settings
Every setting has a default; see them all with `saw config show --resolved`. A few to look at first:

```bash
saw config set checks.test "bun test"
saw config set features.trail true --scope local
saw config set agents.enabled '["claude","codex"]'
```

Settings are layered: `~/.saw/config.toml` (yours, every project), `workflow.toml` (committed, the team's) and `workflow.local.toml` (yours, this project, gitignored). Personal values such as `knowledge.vault_path` and `release.names` only count from your own layers, and a committed `workflow.toml` can only tighten the guardrails (`safety`, `autonomy`). For more agents, run `saw init --agents codex,cursor,gemini`, then `saw agents check`. The [configuration guide](../how-to/configuration.md) goes step by step, and [profiles](../reference/profiles.md) has ready-made sets.

### Optional: the unslop UI polish skill
For UI work, the `design` playbook can add a polish pass with [unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky (CC BY 4.0). It isn't bundled. Install it at the commit pinned in `deps.lock.toml`, then turn it on:

```bash
git clone https://github.com/heydamir/unslop ~/.claude/skills/unslop
git -C ~/.claude/skills/unslop checkout 1d13095e4bef6ad6c74f1dd828d84c4ba309a4dc
saw config set features.unslop true
```

Its `scripts/` (Playwright and ffmpeg) run only when you invoke them.

## 5. Your first task
Ask Claude Code for something as usual. The `router` skill classifies it as trivial, standard, complex or critical, and opens it:

```bash
saw task start --tier standard --playbook feature
```

It prints the steps for that tier. While you work:
- `saw run test` runs a check quietly and records the result.
- `saw task record code_review pass --note "..."` records a judgement check.
- `saw task status` shows which checks passed, failed or are missing. The `gate` hook won't let the agent say "done" until they pass.
- `saw task report` writes the verification section for the PR, and `saw task end` appends the task's metrics.

## 6. Improve from evidence
After a few tasks:
- `saw dashboard` writes `.saw/dashboard.html` (first-pass rate, findings, rework, cost per task, and a timeline of recent events).
- `saw dashboard --serve [--port 4173]` serves the same page live on `127.0.0.1` and reloads it whenever `.saw/metrics.jsonl` or `.saw/events.jsonl` changes. It answers only to loopback host names.
- `.saw/events.jsonl` logs one JSON line per workflow event: the tier picked by `saw task start`, Stop-hook (`gate`) blocks and passes, commands `saw guard` denied or rewrote, budget warnings, review-session starts and results, and `saw run` results. Full check output stays in `.saw/logs/`.

Settings:

```toml
[logging]
enabled = true     # write .saw/events.jsonl
level = "info"     # debug | info | warn; warn keeps only blocks, denies, failures and budget warnings

[dashboard]
panels = ["outcomes", "first_pass_rate", "findings_by_category", "rework", "cost_per_task", "promotion_effect", "events"]
port = 4173        # saw dashboard --serve
events_limit = 50  # events shown in the timeline
```

Recommended: keep `level = "info"` day to day, and switch to `"debug"` (`saw config set logging.level debug --scope local`) while you work out why a hook behaves oddly. Drop `"events"` from `panels` if you only want the metric charts.

Optional, with Docker: `docker compose up` runs `saw dashboard --serve` in the `oven/bun` image, pinned by digest. It mounts the repo read-only and publishes the port on `127.0.0.1:4173` only. Nothing else in the workflow needs Docker.
- `saw retro` turns checks that keep failing into proposals in `docs/proposals/`.
- `saw eval` runs the eval suite and compares it with the baseline before you adopt a change. There is no baseline until you save one with `saw eval --save-baseline`.

## 7. Before you make a repo public
```bash
saw sanitize
```

It scans every file a push would publish for secrets, home-folder paths, email addresses and your own names (git `user.name` and email, your OS user, plus `release.names`). Mark a line that is meant to stay with `saw-sanitize: allow`, or list public literals in `.sanitize-allow`. Run `saw sanitize --history` too: it scans every line any commit ever added, since a secret deleted later still ships with the history. Commit author names and emails are not scanned: check them with `git log --format='%an <%ae>'`.

## Where next
- [docs/features.md](../reference/features.md): everything the workflow does, including `saw autopilot`.
- [docs/configuration.md](../how-to/configuration.md) and [docs/profiles.md](../reference/profiles.md): tune it for your project.
- `prompts/`: copy-paste prompts for starting a project, a feature, a debug session or a handoff.
