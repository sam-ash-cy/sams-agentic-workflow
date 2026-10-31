# Phase 7: retro-promote and the eval harness

## Goal
Self-improvement from evidence: repeated failures become proposals, each fix is proven by an eval before and after, and the dashboard shows whether it worked.

## Built
- **`saw retro`**: reads `.saw/metrics.jsonl`. Each check that failed in `retro.repeat_threshold` tasks or more (default 2) gets one proposal in `retro.proposals_dir` (default `docs/proposals/`), unless it already has one that isn't rejected.
  - In `suggest` autonomy, with `autonomy.actions.self_improve = "never"`, or with `--dry-run`, it lists candidates and writes nothing.
  - The proposal has the evidence filled in, and sections for root cause, fix, eval case and decision.
- **retro-promote skill**: classifies the root cause (missing context, poor instruction, missing tool, missing test, reasoning error), prefers the most enforceable fix (test/lint > hook > skill edit > AGENTS.md line), adds a `regress-<check>` eval, and waits for approval.
- **`saw eval`**: runs `claude plugin eval` on this plugin (no ablation arm, `evals.runs` runs per case), saves the JSON in `.saw/evals/`, and compares it with `evals/baseline.json`.
  - It exits 1 if any case scores lower, or costs more than `evals.max_token_increase` (default 10%) extra tokens at the same score. This is the token regression gate.
  - `--save-baseline` records a new baseline. `saw eval compare a.json b.json` compares two saved runs.
- **Eval cases**: the five router and gate cases from Phase 3, converted to `claude plugin eval` folders with LLM graders.
- **promotion_effect panel**: for each proposal marked `status: promoted` with a `promoted:` date, the share of tasks where that check failed, before and after.
- The context nudges, built at the end of Phase 6, ship in this PR (see [[phase-6]]).

## Out of scope
- **Codex evals.** ADR 0012 says `saw eval` adds Codex. Deferred to Phase 8 with the other agent tiers.
- **The code-map benchmark** (Trail vs LSP vs Token Pilot) and **retiring the overlapping global skills.** Both need real eval runs, which are billed to the owner's account; run them once this merges.

## Not verified
- No eval has run yet: each run is a set of real agent sessions. The result JSON of `claude plugin eval` isn't a documented contract, so `summarise` reads any array of objects with a case name and a score. Check it on the first real run.
