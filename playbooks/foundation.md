# Playbook: foundation (stage 0)
**Enter when:** a new project, or one without workflow.toml / docs/.
**Gates:** grilling on goals, users, constraints, stack before any code. Discover decisions; don't invent them.
**Outputs:** `saw init`; `docs/decisions/0001-*.md` for each settled choice; a short AGENTS.md (commands + non-obvious rules only, written by hand, never generated); a roadmap of stages in `docs/plans/roadmap.md`.
**Done when:** the owner approves the roadmap and the first stage's plan.
**Docs (when `features.docs_step` is on):** before the PR, update the docs with `engineering:documentation`, sorted into the Diátaxis split: `docs/tutorials/`, `docs/how-to/`, `docs/reference/`, `docs/explanation/`. Use `mattpocock-skills:writing-for-agents` for `AGENTS.md`, `CLAUDE.md` and skill files.
**Verification (when `features.ecc` is on):** before the PR, run the `ecc:verification-loop` skill (build, types, lint, tests, diff review). ECC is by Affaan Mustafa, https://github.com/affaan-m/ECC, MIT; pinned in `deps.lock.toml`.
**Launch video (optional, when `features.brag` is on):** after the PR merges, offer a short launch video with the `brag` skill. Credit the music (CC BY 4.0, Sascha Ende) wherever it is published.
