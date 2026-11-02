---
title: agent-browser as optional ui-verifier fallback
author: Samash1234567
date: 2026-11-02
branch: feat/profile-recommendations
cost: { minutes: 25, tokens: 117374 }
touches:
  - agents/implementer.md
  - agents/ui-verifier.md
  - cli/src/about-me.ts
  - cli/src/defaults.ts
  - cli/src/main.ts
  - cli/src/recommend.ts
  - cli/src/skills.ts
  - cli/test/recommend.test.ts
  - docs/reference/features.md
  - playbooks/design.md
---

## Decided
- agent-browser is an optional extra with no features.* flag: ui-verifier uses it only when it is on PATH and the host has no browser tools (plain claude terminal, CI). Install pinned: bun add -g agent-browser@<version>, then agent-browser install.
- agent-desktop was considered and skipped: desktop-app automation is out of scope and exposes screen/clipboard data.
## Watch out
- ui-verifier must not report a pass without a browser; it stops and says so.
