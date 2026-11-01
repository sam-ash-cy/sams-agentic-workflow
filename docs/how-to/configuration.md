# Configuration guide

Every setting has a working default, so a fresh `saw init` is usable as it is. This guide changes the few that matter for your project, one step at a time. For what each feature does, see [features.md](../reference/features.md); for ready-made sets of values, see [profiles.md](../reference/profiles.md); for recipes by goal (automation, saving tokens, parallel agents, safety), see [configure-for-goals.md](configure-for-goals.md).

## How settings work

Four layers, later ones win:

| Layer | File | Committed? | For |
|---|---|---|---|
| defaults | built in | n/a | everything has one |
| global | `~/.saw/config.toml` | no | your defaults for every project |
| project | `workflow.toml` | yes | the team's settings for this repo |
| local | `workflow.local.toml` | no (gitignored) | your settings for this repo |

Two rules:
- A committed `workflow.toml` can only make `safety.*`, `autonomy.*`, `features.parallel_sessions` and `features.worktrees` **stricter**. Loosen them in global or local.
- Personal values (`knowledge.vault_path`, `release.names`) only count from global or local.

Use the CLI rather than editing files by hand: it validates each value and keeps the file's comments.

```bash
saw config show              # what's set, and which layer it came from
saw config show --resolved   # every key with its value
saw config get tokens.mode
saw config set tokens.mode hard                    # project (default)
saw config set style.tone structured --scope global
saw config set autonomy.actions.commit allow --scope local
saw config unset tokens.mode
```

Lists are JSON: `saw config set agents.enabled '["claude","codex"]'`. For one task only, add `--set key=value` to any command. Run `saw doctor` after changes: it reports unknown keys, bad values and weakened guardrails.

You can also ask Claude: the `saw-settings` skill asks what you want, picks the layer and runs the commands.

## Step 1: tell saw how to check your code

The gate needs real commands. Set the ones your project has; leave out the rest.

```bash
saw config set checks.test "bun test"
saw config set checks.lint "bun run lint"
saw config set checks.typecheck "bunx tsc --noEmit"
saw config set checks.format "bunx prettier --check ."
saw run test
```

`saw init` sets `checks.dep_audit` from your lockfiles. Then look at what each tier requires:

```bash
saw config get verify.standard
```

If a tier needs a check you don't have (no e2e suite yet), take it out for this project:

```bash
saw config set verify.critical.run '["dep_audit","threat_model","rollback_plan"]'
```

Checks without a command (`code_review`, `security_review`, `threat_model`, `rollback_plan`) are recorded by the agent with `saw task record`.

## Step 2: choose how much the agent may do on its own

`autonomy.level` sets the overall stance: `suggest` (never acts), `propose` (default: acts, asks for anything outward-facing) or `act`. Then each action is `never`, `ask` or `allow`:

```bash
saw config get autonomy.actions
saw config set autonomy.actions.commit allow --scope local   # your choice, not the team's
saw config set autonomy.actions.push never
```

`[safety]` stays on whatever the autonomy: the deny-list, approvals for destructive and deploy commands, and no `.env` reads. Add your own deny entries from the project layer (it can only add):

```bash
saw config set safety.deny '["rm -rf","git push --force","git push -f","curl | sh","kubectl delete"]'
```

## Step 3: set the token and context limits

```bash
saw config get tokens.budget
saw config set tokens.mode hard          # stop at the budget instead of warning
saw config set context.window_tokens 1000000   # if you use a 1M-context model
```

Model routing: `models.mode = "routed"` (default) gives cheap models to exploring and research and strong ones to implementing and security review. Change a role or a model name:

```bash
saw config set models.roles.review strong
saw config set models.strong claude-opus-5-5
saw sync
```

`saw sync` writes the models into the agent files. `models.mode = "single"` makes every agent use your session's model.

## Step 4: choose how replies look

```bash
saw config set style.tone structured --scope global   # normal | structured | detailed | verbose
saw config set style.max_words 200 --scope global
saw config set style.mode hard                         # ask for a rewrite when over the cap
```

`style.by_tier` sets a cap per tier (0 = use `max_words`). Code blocks don't count.

## Step 5: turn features on or off

All of these are on by default except `trail`, `parallel_sessions`, `unslop` and `brag`:

```bash
saw config set features.grilling false     # skip the up-front questions on complex tasks
saw config set features.trail true --scope local   # if you have Trail installed
saw config set features.unslop true        # after installing it (install.md)
saw config set features.brag true          # launch videos, after installing it (install.md)
saw config set features.docs_step false    # skip the docs step at the end of feature tasks
saw sync                                   # denies the skills of features you turned off
```

Off by default and worth a look once you're comfortable:
- `review_session.enabled`: an independent read-only review before each feature, phase or stage PR.
- `sessions.mode = "hard"`: insist on a fresh session per unit of work.
- `repo.enabled`: manage GitHub settings from `[repo]` (`saw repo plan`, then `saw repo apply --yes`).
- `autopilot.enabled`: work through an approved queue unattended ([features.md](../reference/features.md#autopilot)).

## Step 6: your personal layer

```bash
saw config set knowledge.vault_path "/absolute/path/to/vault" --scope global
saw config set knowledge.store both
saw config set release.names '["your-handle"]' --scope global
```

## Step 7: check it

```bash
saw doctor --hooks
saw task start --tier standard --playbook feature
saw task status
```

`saw doctor: ok` and a task that lists your real checks means you're set.
