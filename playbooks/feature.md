# Playbook: feature (also refactors)
**Enter when:** adding or changing behaviour in existing structure.
**Gates:** acceptance criteria first; tdd. Refactors: behaviour unchanged, map callers/impact first, tests green before and after.
**Outputs:** code + tests; `docs/features/<name>.md` when it ships.
**Done when:** the tier's checks pass, including code review and security review.
**Docs (when `features.docs_step` is on):** before the PR, update the docs with `engineering:documentation`, sorted into the Diátaxis split: `docs/tutorials/`, `docs/how-to/`, `docs/reference/`, `docs/explanation/`. Use `mattpocock-skills:writing-for-agents` for `AGENTS.md`, `CLAUDE.md` and skill files.
**Verification (when `features.ecc` is on):** before the PR, run the `ecc:verification-loop` skill (build, types, lint, tests, diff review). ECC is by Affaan Mustafa, https://github.com/affaan-m/ECC, MIT; pinned in `deps.lock.toml`.
**Launch video (optional, when `features.brag` is on):** after the PR merges, offer a short launch video with the `brag` skill. Credit the music (CC BY 4.0, Sascha Ende) wherever it is published.
