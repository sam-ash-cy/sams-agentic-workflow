---
type: llm
weight: 1
---

Pass if the response treats this as a follow-up within phase 9 (no `--unit`, or the same `--unit-id phase-9`), gets no `saw sessions` warning or block, and carries on in this session without asking for a handoff or a new session. Fail if it opens a new unit or asks for a fresh session.
