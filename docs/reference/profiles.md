# Recommended settings

Four starting points. Pick the closest, apply it, then adjust ([configuration.md](../how-to/configuration.md)). Each one says which layer it belongs in: guardrails (`safety`, `autonomy`, the session toggles) can only be loosened from your own layers, so a profile that loosens them goes in `workflow.local.toml` or `~/.saw/config.toml`, not the committed `workflow.toml`.

To apply one, merge it into the file named, then run `saw doctor`. `saw init` already writes some of these tables (`[autonomy]` among them), so set the keys inside the existing table rather than pasting a second copy: TOML rejects a table defined twice, and every saw command then fails. Keys you leave out keep their defaults.

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
