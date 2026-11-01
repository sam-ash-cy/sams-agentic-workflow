# 0014: Autonomous runner (`saw autopilot`)

- Status: proposed
- Date: 2026-10-31
- Roadmap: Phase 13, after evals (Phase 7), Tier 2 (Phase 8) and the public release (Phase 12), which can ship without it.

## Context
The owner wants Claude to work through planned and **approved** features on its own: one after another, unattended. When a usage limit is hit, it should wait for the reset and carry on from where it stopped. The gate (Phase 3), budgets and metrics (Phase 6) and evals (Phase 7) are what make this safe enough to try.

## Decision (proposed)
A `saw autopilot` command drives headless Claude Code (`claude -p`) over a queue.

- **Queue:** `docs/plans/queue.md` (or `[autopilot] queue`). Only items marked `approved` (by the owner, in a committed file) are eligible. The runner never approves anything and never adds work to the queue. It can propose new items, which wait in `proposed`.
- **One item = one fresh session = one branch = one PR.** Each run is `claude -p "<router prompt for item N>" --max-budget-usd <per-item cap>`. The session runs the router, playbook and gate as usual. If it ends Blocked or Not verified, the item is parked and the runner moves on.
- **Autonomy still applies.** Commit and push follow `autonomy.actions`. The default is `propose`: the runner commits on the item's branch and opens a PR only if `open_pr = "allow"`. It never merges, never pushes to main, and never deploys. Destructive or deploy actions stop the item.
- **Limit reset:** when a run fails on a usage or rate limit, the runner saves state to `.saw/autopilot.json` (the current item, its branch, the session id) and sleeps until the reset time. It reads that time from the error when available, and otherwise backs off from 15 minutes up to `[autopilot] max_wait`. It then resumes the same session (`claude --resume <id>`) rather than starting over. Runs are idempotent: restarting the runner continues from the saved state.
- **Scheduling:** run in the foreground, or as a scheduled task (Windows Task Scheduler, cron or launchd), or as a cloud routine. `saw autopilot --install-schedule` prints the command and does not register it unless asked.
- **Stops:** stops on an empty queue, a total budget cap (`[autopilot] max_total_usd`), N consecutive failed items, a weakened `[safety]` setting, or a `STOP` file in `.saw/`. Each item and each wait is written to `.saw/metrics.jsonl` and shown on the dashboard.

```toml
[autopilot]
enabled = false            # opt-in
queue = "docs/plans/queue.md"
per_item_usd = 5
max_total_usd = 30
max_failures = 2
max_wait = "6h"
resume_on_limit = true
```

## To verify before building
- Check the exact headless flags in the current docs: `-p`, `--resume`, `--max-budget-usd`, `--output-format json`.
- Find out how a usage-limit error and its reset time appear in headless output.
- Check whether Anthropic's terms allow unattended looping on a subscription plan, or whether it needs API billing.

## Consequences
- Unattended runs cost real money and can drift. That's why it's opt-in, works only on approved items, has hard caps, and ends every item in a PR the owner reviews.
- It depends on the gate being trustworthy, which is why it comes after the evals phase.
