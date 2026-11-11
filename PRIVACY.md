# Privacy policy

sams-agentic-workflow (saw) and its mods run on your machine. The author runs no server and receives nothing: no telemetry, analytics, crash reports or usage pings. Everything the plugin stores stays in the files listed below, and everything it sends goes through tools you already use and have signed in to yourself.

## What it stores, and where

All of these are plain files you can read, edit or delete. Deleting them turns the feature back to its defaults.

| File | What's in it | Written by |
|---|---|---|
| `~/.saw/about-me.md`, `.saw/about-me.local.md`, `docs/about-me.md` | Your answers to the optional about-me interview (role, goals, working preferences, anything else you type). It may include personal details if you enter them. The `docs/` copy is meant for committing, so the skill keeps names, emails and paths out of it. | `about-me` skill, `saw about-me` |
| `~/.saw/` (other files) | Your global saw settings, and a local key that signs review records so they can't be forged. | `saw init`, `saw settings`, reviews |
| `~/.saw/projects.json` | The folders saw has been used in: each one's path, name, when it was added and last seen. It only remembers folders; removing an entry deletes nothing. | `saw init`, `saw task start`, `saw projects`, the dashboard |
| `workflow.toml`, `.saw/` settings | Project settings. | `saw settings` |
| `.saw/task.json` | The open task: its name, tier, start time and recorded checks. | `saw task` |
| `.saw/metrics.jsonl` | Per-task metrics: tier, duration, token and dollar counts, check results, autopilot runs. No prompt or file contents. | `saw task end`, autopilot |
| `.saw/logs/` | Full output of commands whose terminal output saw shortened, so you can read the rest. | output feature |
| `.saw/dashboard.html` | A local report built from the metrics above. | `saw dashboard` |
| `.claude/handoff.md`, `.claude/handoff.used.md` | A summary of your session written by Claude for the next session. It can contain anything discussed in the session. | prompt-band mod (Write handoff note) |
| `.claude/output/` | The full text of long tool outputs that were shortened before reaching the model. This can include anything a command printed. | context-saver mod |
| `.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json` | Hooks, permissions and deny-lists saw installs for Claude Code. | `saw init`, `saw sync` |
| Claude Code's plugin store | Mod state such as the daily Improve count, cooldowns and the session cost shown in the prompt band. | mods |
| Retro and learning notes (`docs/`, `.trail/learnings/`) | Lessons from past tasks, written in your words. They go into the repo only if you commit them. | retro skills |

## What it reads

- Your project's files, git history and git config, to run checks, route tasks and build commit and PR text. As part of this, `saw sanitize` and `saw release` look for secrets, home paths and email addresses so it can **block** them from being published.
- Claude Code's own session data handed to hooks (prompts, tool calls, context size, cost), to apply guardrails, budgets and the context guard. The `secrets-redactor` mod reads tool output to remove secrets before the model sees them.
- The output of `claude plugin list`, to check which recommended plugins are installed.

## What it sends, and to whom

saw has no network code of its own. Data leaves your machine only through these tools, under your own accounts and their own terms:

- **Claude (Anthropic), through Claude Code.** Improve prompt sends your draft prompt. Write handoff note asks the current session to summarise itself. Autopilot and independent reviews start `claude -p` sessions that read your repo. All of these use your Claude account and are covered by Anthropic's terms and privacy policy.
- **GitHub, through the `gh` CLI.** This happens only when you run a command that does it: autopilot opening a PR, or posting a review as a PR comment. It uses your `gh` login.
- **Plugin marketplaces, through `claude plugin`.** This happens only when you choose to install a recommended plugin.
- **Your clipboard.** The render mod's copy action puts the content you chose there.
- **Localhost only.** `saw dashboard` serves its page on your own machine and accepts no outside connections. From that page you can change your settings files and switch mods on or off (`enabledPlugins` in your Claude `settings.json` or the project's `.claude/settings.local.json`); every change is logged in `.saw/events.jsonl`.

## Third parties

Plugins and tools saw recommends or pins (for example Matt Pocock's skills, Anthropic's engineering plugin, trail) are separate software. You install them yourself, and their own policies apply.

## Children

saw is a developer tool and is not directed at anyone under 18.

## Changes and contact

Changes to this policy are made in this file and recorded in the repo's history. Questions: [open an issue](https://github.com/sam-ash-cy/sams-agentic-workflow/issues).
