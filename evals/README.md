# Evals

Each case is a folder: `prompt.md` (the task, plus `max_turns`, `allowed_tools` and `tags` in frontmatter) and `graders/*.md` (what passing looks like, judged by an LLM grader). The runner is Claude Code's built-in `claude plugin eval`; `saw eval` wraps it.

| Case | Checks that |
|---|---|
| router-trivial | a typo fix skips planning, grilling and subagents |
| router-standard | a normal feature gets acceptance criteria, tests first and every required check |
| router-complex | a new subsystem starts with grilling, options and an ADR, and waits for approval |
| router-critical | handling secrets gets a threat model and the hardening playbook |
| gate-blocks | "done" is never claimed before the checks run |

## Running
```
saw eval --save-baseline        # before a change: record each case's score and tokens
saw eval                        # after: exit 1 if any case scores lower, or costs >10% more tokens at the same score
saw eval --case router-*        # just some cases
saw eval compare a.json b.json  # compare two saved runs
```
Each run is a real agent session per case (3 runs each by default, `evals.runs`), billed to your account. The first run asks you to trust the plugin.

## Regression cases
`saw retro` writes a proposal for each repeated failure. Its fix comes with a case here that reproduces the failure: name it `regress-<check>`, and keep it once the fix lands.
