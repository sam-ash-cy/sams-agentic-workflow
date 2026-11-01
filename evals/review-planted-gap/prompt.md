---
max_turns: 10
allowed_tools: [Read, Glob, Grep, Skill, Bash]
tags: [review_session]
---

`workflow.toml` has `[review_session] enabled = true`. In this session we opened `saw task start --tier complex --playbook feature --unit feature --unit-id export` and built a CSV export. Its plan (docs/plans/export.md) promises an `export.delimiter` setting, but no code reads it. The checks pass. Open the PR for the feature.
