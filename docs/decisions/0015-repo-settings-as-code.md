# 0015: Repository settings as code (`saw repo`)

- Status: proposed
- Date: 2026-10-31
- Roadmap: Phase 8b, after the Tier 2 agents and before the public release, so the release can apply them to this repo.

## Context
A project's GitHub settings (merge options, branch protection, security features, labels) are set by hand today, so they drift and can't be replicated. They can be set from a script:

- **`gh repo edit`:** visibility, description, topics, default branch, merge methods (`--enable-squash-merge`, `--enable-merge-commit`, `--enable-rebase-merge`), `--delete-branch-on-merge`, `--enable-auto-merge`, and issues, wiki and projects.
- **REST, through `gh api`:**
  - rulesets: `repos/{owner}/{repo}/rulesets` (or the older branch protection, `repos/{owner}/{repo}/branches/{branch}/protection`)
  - security features: `PATCH repos/{owner}/{repo}` with `security_and_analysis` for secret scanning and push protection; `PUT .../vulnerability-alerts` and `.../automated-security-fixes`
  - labels: `repos/{owner}/{repo}/labels`
  - environments: `repos/{owner}/{repo}/environments/{name}`
  - Actions permissions: `repos/{owner}/{repo}/actions/permissions`
- **`gh secret set` / `gh variable set`:** secrets and variables. The values never go in config.

Some features depend on the plan. For example, rulesets and secret scanning on private repos need a paid plan or GitHub Advanced Security, and the API returns 403 or 404 when a feature isn't available.

## Decision (proposed)
- A `[repo]` section in `workflow.toml` declares the desired state:

  ```toml
  [repo]
  enabled = false
  merge = { squash = true, merge_commit = false, rebase = false, delete_branch_on_merge = true, auto_merge = false }
  protect = { branch = "main", require_pr = true, required_approvals = 1, required_checks = ["ci"], block_force_push = true }
  security = { secret_scanning = true, push_protection = true, dependabot_alerts = true, dependabot_fixes = true }
  labels = ["tier:trivial", "tier:standard", "tier:complex", "tier:critical"]
  ```

- `saw repo plan` reads the current settings with `gh api` and prints a diff. It is read-only.
- `saw repo apply` shows the plan, asks for confirmation, then applies it and re-reads the settings to verify.
  - It never changes visibility, deletes anything, or sets secret values.
  - An unsupported feature is reported as `skipped (plan)`, not as an error.
- The repo is detected from `gh repo view --json nameWithOwner`; `--repo owner/name` overrides it.
- `saw init --repo` offers to run `plan` once.
- Uses the user's own `gh auth` and stores no tokens.

## Consequences
- Every project's settings become reproducible and reviewable in a PR.
- Applying them is outward-facing, so the user always confirms, at every autonomy level.
