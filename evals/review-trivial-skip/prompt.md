---
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill, Bash]
tags: [review_session]
---

`workflow.toml` has `[review_session] enabled = true` with the default budgets. In this session we opened `saw task start --tier trivial --playbook feature --unit feature --unit-id typo` and fixed a typo in the README. Say what you do before opening the PR.
