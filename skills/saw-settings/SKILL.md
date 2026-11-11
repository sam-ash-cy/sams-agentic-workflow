---
name: saw-settings
description: Use when the user wants to change how the workflow behaves — enable or disable a feature, change autonomy, budgets, models, or any workflow.toml setting. Grills briefly, then writes the right settings layer with the saw CLI.
---

1. Run `saw config show` to see what is set and where it came from.
2. Ask what they want and why, then recommend the layer:
   - `project` (workflow.toml, committed): team-wide behaviour.
   - `local` (workflow.local.toml, git-ignored): personal preference for this repo.
   - `global` (~/.saw/config.toml): personal default for every repo.
   Guardrail keys (`safety.*`, `autonomy.*`, `features.parallel_sessions`, `features.worktrees`, `verify.mode`, `enforcement`) can only be loosened in `global` or `local`; a committed workflow.toml may only tighten them. Changing them asks the user (saw guard).
   "Enforce everything" / "turn enforcement down": set `enforcement = "strict"` (routing, verify, tdd, tokens, style and sessions modes all hard) or `"relaxed"` (all soft); `"custom"` hands control back to each `*.mode` key. The preset wins over those keys, so tell the user that a single `*.mode` change does nothing while a preset is set. "Pick the tier for me": `routing.auto` = `off` | `suggest` (the nudge proposes the `saw task start` line) | `open` (saw opens a provisional task that holds commits until confirmed).
3. Apply with `saw config set <key> <value> --scope <layer>`, then run `saw doctor` and report its result.
4. Model or effort per phase/tier ("plan on opus low", "implement on sonnet medium", "critical implement on opus high"): set `models.phases.<phase>.model` / `.effort`, or `models.phases.<phase>.<tier>.*` for one tier, then run `saw sync`. For the plan phase (the main session) add `saw sync --session` and tell the user to restart. Be plain about strength: subagent models are enforced, the main session's model is only a setting at next start (or `opusplan`) plus a warning.
