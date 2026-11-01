# Playbook: audit
**Enter when:** `/saw audit <name>`, a hardening stage, or the configured cadence.
**Gates:** state each auditor's token budget before running it; skills from third parties must be pinned (deps.lock.toml).
**Outputs:** findings in one schema (confirmed / needs_validation / rejected) in docs/audits/ and .saw/findings.jsonl.
**Done when:** every confirmed finding is fixed, ticketed, or accepted by the owner.
