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

The bootstrap installs the Claude Code plugin from this folder's marketplace, copies `global/CLAUDE.md` to `~/.claude/saw-workflow.md` and imports it from your `~/.claude/CLAUDE.md`. It copies `global/settings.example.json` only if you have no `settings.json`.

Put `bin/` on your `PATH` (or run `bun cli/src/main.ts` instead of `saw`), then check the setup:

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
saw config set features.trail true
saw config set agents.enabled '["claude","codex"]'
```

Settings are layered: `~/.saw/config.toml` (yours, every project), `workflow.toml` (committed, the team's) and `workflow.local.toml` (yours, this project, gitignored). Personal values such as `knowledge.vault_path` and `release.names` only count from your own layers. For more agents, run `saw init --agents codex,cursor,gemini`, then `saw agents check`.

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
- `saw dashboard` writes `.saw/dashboard.html` (first-pass rate, findings, rework, cost per task).
- `saw retro` turns checks that keep failing into proposals in `docs/proposals/`.
- `saw eval` runs the eval suite and compares it with the baseline before you adopt a change.

## 7. Before you make a repo public
```bash
saw sanitize
```

It scans every file a push would publish for secrets, home-folder paths, email addresses and your own names (git `user.name` and email, your OS user, plus `release.names`). Mark a line that is meant to stay with `saw-sanitize: allow`, or list public literals in `.sanitize-allow`. Commit author names and emails are not scanned: check them with `git log --format='%an <%ae>'`.

## Where next
- `docs/BLUEPRINT.md`: the design and the roadmap.
- `docs/decisions/`: why each choice was made.
- `prompts/`: copy-paste prompts for starting a project, a feature, a debug session or a handoff.
