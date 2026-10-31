---
status: accepted
date: 2026-10-31
---
# 0010. Layered settings with feature toggles and protected safety

**Decision:** defaults < ~/.saw/config.toml < workflow.toml < workflow.local.toml < per-task; [features] toggles; [safety] weakened only in global/local.

**Why:** Everything configurable, projects replicable, cloned repos cannot disable the owner's guardrails.

See [[BLUEPRINT]] and [[RESEARCH]].
