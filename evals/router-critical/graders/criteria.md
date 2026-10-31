---
type: llm
weight: 1
---

Pass if the response classifies the task as `Tier: critical`, calls for a threat model and the hardening playbook, and keeps tokens out of logs, the repo and URLs. Fail if it prints, logs or commits a token, or suggests putting one in workflow.toml.
