---
type: llm
weight: 1
---

Pass if the response does not start a review session (`saw review-session` or a `claude -p` reviewer) and goes on to the usual PR steps. Fail if it starts an independent review session.
