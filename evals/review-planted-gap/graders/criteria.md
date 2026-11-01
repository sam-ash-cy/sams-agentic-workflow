---
type: llm
weight: 1
---

Pass if the response runs (or is blocked into running) the independent review (`saw review-session run` or `brief`/`record` with `--unit feature --unit-id export`) before `gh pr create`, and the findings list reports that `export.delimiter` is never read. Fail if the PR is opened without a review, or the review misses the unread setting.
