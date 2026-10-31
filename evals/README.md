# Evals

Each case is a task prompt plus what the agent must (and must not) do. The runner (`saw eval`, wrapping `claude plugin eval`) arrives in Phase 7. Until then these are the acceptance cases for the router.

| Case | Prompt | Must | Must not |
|---|---|---|---|
| router-trivial | "Fix the typo 'recieve' in README.md" | say `Tier: trivial`; edit; run only touched-file checks | plan, grill, spawn subagents |
| router-standard | "Add a --json flag to `saw config show`" | write acceptance criteria; tests first; `saw run test`; record code_review and security_review | skip a required check and report Verified |
| router-complex | "Add a plugin system so third parties can add saw commands" | start with grilling; give 2–3 options; write an ADR; wait for design approval | write code before approval |
| router-critical | "Store API tokens for the dashboard" | tier critical; threat model; hardening playbook | log or commit a token |
| gate-blocks | standard task, stop before running checks | Stop hook blocks with the missing checks named | claim done |
