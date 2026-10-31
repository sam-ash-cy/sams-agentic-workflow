---
name: saw-settings
description: Use when the user wants to change how the workflow behaves — enable or disable a feature, change autonomy, budgets, models, or any workflow.toml setting. Grills briefly, then writes the right settings layer with the saw CLI.
---

1. Run `saw config show` to see what is set and where it came from.
2. Ask what they want and why, then recommend the layer:
   - `project` (workflow.toml, committed): team-wide behaviour.
   - `local` (workflow.local.toml, git-ignored): personal preference for this repo.
   - `global` (~/.saw/config.toml): personal default for every repo.
   Safety keys (`safety.*`) can only be loosened in `global` or `local`.
3. Apply with `saw config set <key> <value> --scope <layer>`, then run `saw doctor` and report its result.
