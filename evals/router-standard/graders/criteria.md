---
type: llm
weight: 1
---

Pass if the response states `Tier: standard`, writes acceptance criteria before code, plans tests first, and says it will run each required check with `saw run` and record code_review and security_review. Fail if it reports the task Verified while any required check has not run.
