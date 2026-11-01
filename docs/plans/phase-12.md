# Phase 12: public release

## Goal
The repo can go public without leaking anything personal, under the MIT licence, with a walkthrough a stranger can follow. Going public itself (repo visibility, a tag, the marketplace) waits for the owner's explicit OK.

This branch stacks on Phases 10 and 11: `feat/phase-12-release` is cut from `feat/phase-11-audit-session`, which carries Phase 10. Both have since been merged to `main` (PRs 12 and 13), so the PR can target `main` directly.

## Built
- **`saw sanitize`**: scans every file a push would publish (tracked, plus untracked files git doesn't ignore) and exits 1 on any finding:
  - secrets: private keys, AWS, GitHub, Anthropic, OpenAI, Slack and Google keys, and quoted `password = "..."`-style assignments. A finding names the kind of secret, never its value, so CI logs don't repeat it.
  - home-folder paths with a real user name (`C:\Users\<name>`, `/Users/<name>`, `/home/<name>`); placeholders and CI runner homes don't match.
  - email addresses, except `noreply@`, GitHub noreply, `example.*` and file names that look like domains (`@saw-workflow.md`).
  - your own names: git `user.name` and `user.email`, the OS user (3 characters or more), plus `release.names`. They come from this machine, not a committed list, so the scan doesn't publish them. `release.names` is honoured only from the global or local layer; set in `workflow.toml` it is an error.
  - Opt-outs: `saw-sanitize: allow` on a line, or a literal in `.sanitize-allow` (the repo's own GitHub owner is listed there).
- **CI** runs `saw sanitize` on all three OSes.
- **`LICENSE`** (MIT), `"license": "MIT"` in `package.json` (`plugin.json` already had it).
- **`GETTING_STARTED.md`**: install, `saw doctor`, `saw init`, settings, a first task through the gate, the evidence loop, and the pre-release scan. **`README.md`** points to it.

- **unslop** ([heydamir/unslop](https://github.com/heydamir/unslop), by Damir Sokolovsky, CC BY 4.0): pinned in `deps.lock.toml` at `1d13095e`, reviewed by the owner on 2026-11-01. SKILL.md and the references only load; the Playwright and ffmpeg scripts run only when invoked. It is not vendored, so the repo carries no CC BY material and stays MIT-only. The README, GETTING_STARTED and the design playbook credit him and link the repo. `CC-BY-4.0` is added to `deps.allowed_licences`. `features.unslop` (default off) adds a polish step to design-playbook tasks; when it's off, `saw sync` denies the skill.

## Scan results
- Files: clean apart from the repo's GitHub owner in `.claude-plugin/marketplace.json` and `templates/project/.github/workflows/saw.yml`. Both are the public repo's identity and must stay, so they are in `.sanitize-allow`.
- History: no file content in any commit has a personal path or email. Every commit's author and committer line carries the owner's name and personal email; the scan doesn't cover these (see Not verified).

## Out of scope (owner's call)
- Making the repo public, tagging `v0.1.0`, listing in a marketplace, and pinning the template CI checkout to that tag.
- Rewriting commit authors to a noreply address. That rewrites every SHA, so it needs a decision before anything is public.

## Not verified
- Commit metadata isn't scanned: check it with `git log --format='%an <%ae> | %cn <%ce>'`.
- The scan is pattern based; it won't catch a secret in an unknown format or a name that isn't configured.
