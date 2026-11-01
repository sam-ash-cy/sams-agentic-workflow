# Install guide

Written for an AI agent installing the workflow for a user, and just as usable by hand. Each step says what to run, what output means it worked, and what to do when it didn't. Every command here was run against a scratch machine profile and a scratch repo.

Rules for the agent:
- Run the `--dry-run` / `-DryRun` form first and show the user what will change. Nothing here overwrites a file without a backup, but files outside the project (`~/.claude`, `~/.saw`) are the user's: ask before the real run.
- Don't put the user's own names, paths or keys in `workflow.toml`; that file is committed. Personal values go in `~/.saw/config.toml` or `workflow.local.toml`.
- Shell syntax below is POSIX sh. On Windows PowerShell, use the `.ps1` script and `$env:NAME = "value"` for environment variables.

## 0. Prerequisites

| Tool | Check | Needed for |
|---|---|---|
| [bun](https://bun.sh) 1.3+ | `bun --version` | the `saw` CLI (TypeScript, no npm dependencies) |
| git | `git --version` | everything |
| [Claude Code](https://claude.com/claude-code) | `claude --version` | the plugin (skills, agents, hooks) and `saw autopilot` |
| `gh` (optional) | `gh --version` | `saw repo`, `saw task report --post` |

If bun is missing, install it from bun.sh. Don't substitute npm or node: `saw` runs on bun.

## 1. Get the workflow

Clone it somewhere permanent (the plugin and `saw` run from this folder, so don't clone into a temp dir):

```bash
git clone https://github.com/sam-ash-cy/sams-agentic-workflow.git ~/sams-agentic-workflow
cd ~/sams-agentic-workflow
```

Put `bin/` on the user's PATH so `saw` works in any project (`bin/saw` on macOS/Linux, `bin/saw.cmd` on Windows). Without it, run `bun ~/sams-agentic-workflow/cli/src/main.ts` wherever this guide says `saw`.

```bash
export PATH="$HOME/sams-agentic-workflow/bin:$PATH"   # add to ~/.bashrc or ~/.zshrc too
saw doctor
```

On Windows, add `%USERPROFILE%\sams-agentic-workflow\bin` to the user PATH (System Properties → Environment Variables), then open a new terminal.

Works when: `saw doctor` runs. Until step 2 it reports one problem, `Claude Code plugin sams-agentic-workflow is not installed`; that is expected. `saw doctor --no-plugin` skips that check.

## 2. Global setup (once per machine)

The bootstrap script does three things in `~/.claude` (or `$CLAUDE_CONFIG_DIR`):
1. copies `global/CLAUDE.md` to `~/.claude/saw-workflow.md` and adds `@saw-workflow.md` to `~/.claude/CLAUDE.md`, so every session gets the workflow rules
2. copies `global/settings.example.json` to `~/.claude/settings.json` only if there is no `settings.json` yet (otherwise it says `kept:` and leaves merging to you)
3. adds this folder as a plugin marketplace and installs the `sams-agentic-workflow` plugin, which pulls in its `mattpocock-skills` dependency (pinned by commit)

```bash
sh bootstrap.sh --dry-run
sh bootstrap.sh
```

Windows PowerShell:

```powershell
.\bootstrap.ps1 -DryRun
.\bootstrap.ps1
```

Works when:

```bash
claude plugin list
```

shows both `sams-agentic-workflow@sams-agentic-workflow` and `mattpocock-skills@sams-agentic-workflow` with `Status: ✔ enabled`, and `saw doctor` prints `saw doctor: ok` (it runs `claude plugin list` and reports the plugin if it's missing or disabled).

Cloning the repo doesn't install the plugin: Claude Code only loads it after the bootstrap's install step. Without it no hook runs, so nothing is guarded or verified even though `saw` itself works.

If it didn't:
- `skip: plugin install (claude not on PATH)`: the bootstrap prints this and carries on, so it's easy to miss. Make sure `claude --version` works in the same terminal, then re-run the bootstrap; it skips what's already done.
- `failed to load ... Dependency "mattpocock-skills..."`: run `claude plugin install mattpocock-skills@sams-agentic-workflow`.
- Set `SAW_NO_PLUGIN=1` to do only the CLAUDE.md and settings steps.

### Personal settings: `~/.saw/config.toml`

This layer applies to every project and is never committed. Write it with `--scope global` rather than by hand, so values are validated:

```bash
saw config set --scope global style.tone structured
saw config set --scope global knowledge.vault_path "/absolute/path/to/your/vault"
saw config set --scope global release.names '["your-handle"]'
```

`SAW_HOME` moves this folder (default `~/.saw`). `knowledge.vault_path` and `release.names` only count from this layer or `workflow.local.toml`.

## 3. Set up a project

In the root of the user's project (a git repo):

```bash
saw init --dry-run
saw init
```

It adds `workflow.toml`, `AGENTS.md`, `CLAUDE.md` (importing `AGENTS.md`), the `docs/` knowledge vault (decisions, learnings, plans, features, glossary), a CI workflow and a pre-commit hook file, and adds `workflow.local.toml` and `.saw/` to `.gitignore`. Existing files are kept; `--force` backs them up and replaces them. Useful flags:
- `--type web|api|cli|lib|infra` sets `project.type`
- `--hooks` points `core.hooksPath` at `.githooks` (the context lint before each commit); it won't take over another hook manager without `--force`
- `--repo` shows what `saw repo apply` would change on GitHub (read-only)

Then the agent should fill in `AGENTS.md` (build and test commands, non-obvious rules only; keep it short) and set the check commands the project really uses:

```bash
saw config set checks.test "bun test"
saw config set checks.lint "bun run lint"
saw doctor
```

### Other agents

`AGENTS.md` is read by Codex natively. For Cursor and Gemini CLI, add their adapters and tell `saw` to check them:

```bash
saw init --agents codex,cursor,gemini
saw config set agents.enabled '["claude","codex","cursor","gemini"]'
saw agents check
```

Works when: `saw agents check: ok (claude, codex, cursor, gemini)`.

### Plugin for one project only

To enable the plugin for a single project instead of user-wide (the team gets it from the committed `.claude/settings.json`):

```bash
claude plugin marketplace add https://github.com/sam-ash-cy/sams-agentic-workflow.git --scope project
claude plugin install sams-agentic-workflow@sams-agentic-workflow --scope project
claude plugin install mattpocock-skills@sams-agentic-workflow --scope project
```

Use the URL, not a local path: a path in a committed settings file only works on your machine.

### Check the whole setup

```bash
saw doctor --hooks
```

runs each plugin hook once. Works when every line says `ok` and it ends with `saw doctor: ok`.

## 4. Optional extras

- **unslop UI polish** (`features.unslop`): install at the pinned commit, then turn it on.

  ```bash
  git clone https://github.com/heydamir/unslop ~/.claude/skills/unslop
  git -C ~/.claude/skills/unslop checkout 1d13095e4bef6ad6c74f1dd828d84c4ba309a4dc
  saw config set features.unslop true
  saw sync
  ```

- **brag launch videos** (`features.brag`): install the skill at the pinned commit, then turn it on. It renders with [Hyperframes](https://hyperframes.heygen.com/): its own instructions run `npx hyperframes` unpinned, so install a fixed version yourself and prefer `bunx hyperframes@<version>`. It also wants the Hyperframes skills, and optionally `uv` and Python for beat analysis of the music.

  ```bash
  git clone https://github.com/latent-spaces/brag ~/.claude/brag-src
  git -C ~/.claude/brag-src checkout 669ab9286aa28b6c3ee30e75f181ee74319d012a
  cp -r ~/.claude/brag-src/skills/brag ~/.claude/brag-src/skills/brag-slim ~/.claude/skills/
  saw config set features.brag true
  saw sync
  ```

  The bundled music is CC BY 4.0 by Sascha Ende (ende.app): credit him wherever you publish a video.

- **Trail code map** (`features.trail`): install `@trailhq/trail-code` with bun, run `trail init` in the project, then `saw config set features.trail true`.
- **GitHub settings as code**: `saw config set repo.enabled true`, review `saw repo plan`, then `saw repo apply --yes`.
- **Autopilot**: see [Autopilot](../reference/features.md#autopilot). It spends money unattended: only the user turns it on.

## 5. Update

```bash
cd ~/sams-agentic-workflow
git pull
claude plugin marketplace update sams-agentic-workflow
sh bootstrap.sh          # refreshes ~/.claude/saw-workflow.md if global/CLAUDE.md changed (backs up the old one)
```

The plugin is read straight from this folder, so `git pull` updates it; `claude plugin update` only matters for a URL-installed marketplace. Then, in each project:

```bash
saw init --upgrade --dry-run
saw init --upgrade
```

This updates template files the user hasn't edited and lists edited ones as `kept (edited)`; merge those by hand if wanted.

## 6. Uninstall

In each project, remove the template files the user hasn't edited (edited ones are listed and kept):

```bash
saw uninstall --dry-run
saw uninstall
```

`workflow.toml` goes only if unedited (it usually is edited). `workflow.local.toml`, `.saw/`, the `.gitignore` lines, the adapters from `--agents` and `core.hooksPath` stay: remove them by hand if the user wants (`git config --unset core.hooksPath`). Then the plugin and the global files:

```bash
claude plugin uninstall sams-agentic-workflow@sams-agentic-workflow
claude plugin prune
claude plugin marketplace remove sams-agentic-workflow
```

Finally, remove the `@saw-workflow.md` line from `~/.claude/CLAUDE.md`, delete `~/.claude/saw-workflow.md` (and its `.bak.*` copies if not wanted), `~/.saw/`, and the clone, and take `bin/` off the PATH. `~/.claude/settings.json` is left alone: if the bootstrap created it, compare it with `global/settings.example.json` before deleting.
