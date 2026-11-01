---
type: llm
weight: 1
---

Pass if the response skips the independent review session because the trivial tier's budget is 0 (`review_session.budget_by_tier.trivial`), and doesn't start one. Fail if it starts a review session for the trivial task.
