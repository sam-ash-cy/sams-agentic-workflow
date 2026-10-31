---
status: proposed
date: 2026-10-31
---
# 0013. Audit layer: a catalogue of whole-project auditors

**Context:** Per-feature `/code-review` + `/security-review` only see a diff. Whole-project audits catch what diffs miss (trust boundaries, insecure defaults, supply chain, a11y, perf), but they are token-heavy: Cloudflare's security-audit runs many parallel subagents and its README notes one run finds about half of what repeated runs find.

**Decision:** Add an `audit` playbook and an `[audit]` settings section. Auditors are pinned dependencies (deps.lock.toml), each opt-in, each mapped to a trigger:

| Auditor | Source (licence) | Covers | Default trigger |
|---|---|---|---|
| security-audit | cloudflare/security-audit-skill (MIT) | full-repo vuln hunt with adversarial validation, findings.json | `hardening` stage, before first public release |
| insecure-defaults, supply-chain-risk-auditor, differential-review, static-analysis (Semgrep/CodeQL), sharp-edges | trailofbits/skills marketplace (check licence per plugin) | fail-open defaults, dependency risk, history-aware review, SAST | `hardening`; differential-review on critical-tier PRs |
| appsec-review / security-review-checklist | own skills | threat model, spec review | complex/critical design |
| dependency-audit-rules + osv/npm/pip audit | own skill + CLI tools | CVEs, pinning, licences | CI on lockfile change |
| web-quality-audit, accessibility | own skills | perf, a11y, SEO | `design` / `hardening` for UI projects |
| backend-design:audit | installed plugin | component discipline | on demand |
| tech-debt / improve-codebase-architecture | engineering plugin / mattpocock | architecture drift | every N stages (configurable) |

Rules:
- Audits never run on trivial/standard tasks by default (token cost); triggers: `on_stage = ["hardening"]`, `on_tier = ["critical"]`, `every_n_stages`, `before_release`, or `/saw audit <name>` on demand.
- Each auditor gets a token budget (`[audit.<name>] budget`, soft by default) and model routing (hunting on mid, validation on strong).
- Findings normalise into one schema (reuse Cloudflare's findings.json shape: confirmed / needs_validation / rejected) under `docs/audits/<date>-<auditor>.md` + `.saw/findings.jsonl`; confirmed findings become AUDIT.md / roadmap items; recurring categories feed self-improvement (a lint or test, not just a note).
- Third-party auditors bundle scripts, so they go through the supply-chain checks in [[0012-phase-1-revisions]]: pinned SHA, diff review on update, run sandboxed where they execute target code.

**Roadmap:** new Phase 6b "Audit layer" after the review agents (Phase 4) and before metrics: the audit playbook, `[audit]` schema, findings normaliser, Cloudflare + Trail of Bits as pinned optional deps, one eval (seeded vulnerable repo: auditor must report the planted bug as confirmed).

**Open question for the owner:** run security-audit once on aws-security-lab as the pilot (cost estimate first)?
