# Configure for a goal

Recipes for common goals. Each one is a short list of `saw config set` commands with the reason for each; mix them freely. [configuration.md](configuration.md) explains the layers. As a rule, anything that loosens a guardrail (`safety.*`, `autonomy.*`) goes in `--scope local` or `--scope global`, because a committed `workflow.toml` can only tighten those. For whole starting points, see the [profiles](../reference/profiles.md).

After any recipe, run `saw doctor` and, if you changed features or models, `saw sync`.

## Save tokens

For long sessions, big repos or a tight budget.

```bash
saw config set models.mode routed                 # cheap models for exploring and research, strong only where it matters
saw config set models.roles.review mid
saw config set output.quiet true                  # passing checks print nothing, failures only their tail
saw config set output.max_lines 30
saw config set output.rewrite_commands true       # a raw "bun test" runs as saw run test (quiet, recorded)
saw config set context.suggest_compact_at '[0.4,0.6]'   # nudge /compact earlier
saw config set tokens.mode hard                   # stop at the tier's budget, write a handoff
saw config set style.max_words 150 --scope global # shorter replies
saw config set features.trail true --scope local  # if Trail is installed: map lookups instead of reading files
saw config set sessions.mode hard                 # one fresh session per unit of work, no context carried over
saw sync
```

Check the effect after a few tasks with `saw dashboard` (tokens per task by tier).

## Automate work

For working through planned items unattended, and keeping checks running without you.

```bash
# The queue runner (needs the claude CLI; it spends money).
saw config set autopilot.enabled true --scope local
saw config set autopilot.per_item_usd 5 --scope local
saw config set autopilot.max_total_usd 30 --scope local
saw config set autonomy.actions.commit allow --scope local    # headless sessions can't answer an "ask"

# Optional: let the runner push each finished branch and open its PR.
saw config set safety.push allow --scope local
saw config set autonomy.actions.push allow --scope local
saw config set autonomy.actions.open_pr allow --scope local

# Checks the agent runs by itself.
saw config set output.rewrite_commands true
saw config set features.format_hook true
saw config set checks.format "bunx prettier --write ." --scope local   # the format hook only runs commands from your own layers
```

Write the queue in `docs/plans/queue.md` (`- [approved] slug: what to build`), then `saw autopilot status`, a watched `saw autopilot --once`, and `saw autopilot --install-schedule` for the line to add to Task Scheduler or cron. It never merges. Details: [features.md](../reference/features.md#autopilot).

## Run agents in parallel and in review

For bigger work split across sessions, worktrees and independent reviewers.

```bash
saw config set features.worktrees true                        # one worktree per complex task
saw config set features.parallel_sessions true --scope local  # allow splitting a task into sessions
saw config set autonomy.actions.spawn_sessions ask --scope local
saw config set sessions.new_per '["phase","stage","feature"]'
saw config set review_session.enabled true                    # a fresh read-only reviewer before each unit's PR
saw config set review_session.mode both                       # grill against the plan and audit for holes
saw config set models.roles.review strong
saw sync
```

## Use several coding agents

When the team mixes Claude Code with Codex, Cursor or Gemini CLI.

```bash
saw init --agents codex,cursor,gemini
saw config set agents.enabled '["claude","codex","cursor","gemini"]'
saw agents check
```

Keep shared rules in `AGENTS.md` (every agent reads it) and Claude-only notes in `CLAUDE.md`.

## Maximum safety

For production systems, regulated code, or a repo you don't trust yet.

```bash
saw config set autonomy.level suggest            # the agent proposes; you run commits, pushes and PRs
saw config set tokens.mode hard
saw config set routing.always_grill '["standard","complex","critical"]'
saw config set review_session.enabled true
saw config set sessions.mode hard
saw config set safety.deny '["rm -rf","git push --force","git push -f","curl | sh","terraform destroy","kubectl delete"]'
saw config set repo.enabled true                 # then saw repo plan, saw repo apply --yes
```

All of these tighten, so they belong in the committed `workflow.toml` and apply to everyone.

## Move fast on your own project

Fewer questions and approvals; the gate still checks the work.

```bash
saw config set autonomy.actions.commit allow --scope local
saw config set features.grilling false --scope local
saw config set routing.always_grill '["critical"]' --scope local
saw config set style.tone structured --scope global
```

## Improve the workflow from evidence

For tuning the workflow to your project over time.

```bash
saw config set features.metrics true
saw config set retro.repeat_threshold 2
saw config set dashboard.obsidian_note docs/metrics.md     # also write the panels into the vault
saw config set evals.runs 3
```

Then end each task with `saw task end`, look at `saw dashboard` weekly, run `saw retro` to turn repeated failures into proposals, and `saw eval` before adopting a change.

## UI work and launches

```bash
saw config set features.unslop true    # polish pass in the design playbook (install it first)
saw config set features.brag true      # offer a launch video after feature PRs merge (install it first)
saw config set features.docs_step true # update the Diátaxis docs before each feature PR
saw sync
```

Both third-party skills install at their pinned commits: see [install.md](install.md#4-optional-extras).
