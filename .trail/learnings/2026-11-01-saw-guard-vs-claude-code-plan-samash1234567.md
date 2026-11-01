---
title: "saw guard vs Claude Code: plan mode and memory; Stage 11/12 next"
author: Samash1234567
date: 2026-11-01
branch: fix/edit-global-claude-code-dirs
cost: { minutes: 14, tokens: 75245 }
touches:
  - cli/src/guard.ts
  - cli/test/settings.test.ts
  - cli/src/main.ts
  - cli/src/context.ts
---

## Decided
- Stage 10 (10a-10d) is fully merged; nothing exists for 11 or 12 yet. Owner: `tofu plan` against Floci only (OIDC is a doc exercise), Dependabot for pins, Stage 11 split into 11a (pins, dependabot, tofu job, trivy config) and 11b (images, trivy image, SBOM); plan 11 and 12 together.
- saw's edit_global guard now exempts only ~/.claude/plans/*.md and ~/.claude/projects/*/memory/*.md (hard-coded, not a setting, so no layer can widen it). The router nudge no longer prints a user banner on every prompt.
## Tried and ruled out
- Setting edit_global = "allow" to unblock plan mode: it also unlocks CLAUDE.md, settings and hooks.
## Watch out
- With saw on, plan mode can't save its plan until the plugin carries the fix (branch fix/edit-global-claude-code-dirs in sams-agentic-workflow, uncommitted).
- saw-repo files are CRLF: multi-line Python string replacements silently miss; use Edit.
