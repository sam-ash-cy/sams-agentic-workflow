// Built-in defaults: the lowest settings layer. Every valid key appears here,
// so `saw doctor` treats any key missing from this tree as unknown.

export type Value = string | number | boolean | Value[] | Table;
export interface Table {
  [key: string]: Value;
}

export const DEFAULTS: Table = {
  // Every toggle changes what the CLI or a hook does (cli/test/settings.test.ts
  // fails on one that doesn't). grilling, tdd and trail shape the steps
  // `saw task start` prints for the agent; code_review and security_review
  // drop those checks from [verify].
  features: {
    grilling: true,
    tdd: true,
    code_review: true,
    security_review: true,
    verify_hook: true,
    budgets: true,
    model_routing: true,
    compact_nudge: true,
    style_hook: true,
    format_hook: true,
    trail: false,
    obsidian: true,
    metrics: true,
    dashboard: true,
    retro: true,
    audit: true,
    // Phase 10 groundwork: saw task start suggests them; saw guard denies
    // `git worktree add` / `claude -p` when off.
    worktrees: true,
    parallel_sessions: false,
  },
  project: { type: "web" },
  autonomy: {
    level: "propose",
    actions: {
      commit: "ask",
      push: "never",
      open_pr: "ask",
      add_dependency: "ask",
      self_improve: "propose",
      edit_global: "never",
      spawn_sessions: "ask",
    },
  },
  routing: { default_tier: "auto", always_grill: ["complex", "critical"] },
  tokens: {
    mode: "soft",
    warn_at: 0.8,
    budget: { trivial: 20000, standard: 150000, complex: 600000, critical: 1000000 },
  },
  models: {
    mode: "routed",
    cheap: "haiku",
    mid: "sonnet",
    strong: "opus",
    roles: {
      explore: "cheap",
      research: "cheap",
      implement: "strong",
      architect: "strong",
      review: "mid",
      security_review: "strong",
      ui_verify: "mid",
    },
  },
  // Commands for mechanical checks, run by `saw run <name>`. Checks with no
  // command (reviews, threat models) are recorded with `saw task record`.
  checks: {},
  verify: {
    trivial: { run: ["test"] },
    standard: { run: ["format", "lint", "typecheck", "test", "code_review", "security_review"] },
    complex: { extends: "standard", run: [] },
    critical: { extends: "complex", run: ["e2e", "dep_audit", "threat_model", "rollback_plan"] },
  },
  context: {
    agents_md_max_lines: 100,
    claude_md_max_lines: 200,
    // Context-usage nudges (saw context, a UserPromptSubmit hook). Each
    // threshold is a share of window_tokens; each fires once per session.
    window_tokens: 200000,
    suggest_compact_at: [0.5, 0.7],
    handoff_at: 0.85,
  },
  // rewrite_commands: saw guard runs a Bash call that is exactly a [checks]
  // command as `saw run <check>` instead.
  output: { quiet: true, max_lines: 60, full_logs: ".saw/logs", rewrite_commands: false },
  // Reply shape and length. max_words caps prose only (code blocks don't count);
  // by_tier overrides it per tier, 0 = use max_words. saw style-check enforces it.
  style: {
    tone: "normal",
    max_words: 250,
    by_tier: { trivial: 80, standard: 0, complex: 0, critical: 600 },
    mode: "soft",
  },
  // vault_path: the central personal vault (absolute; global or local layer only).
  knowledge: { store: "repo", vault_path: "" },
  // Agents this project supports; saw agents check verifies each reads AGENTS.md.
  agents: { enabled: ["claude"] },
  dashboard: {
    panels: ["outcomes", "first_pass_rate", "findings_by_category", "rework", "cost_per_task", "promotion_effect"],
    output: ".saw/dashboard.html",
    // Also write the panels as a Markdown note, e.g. "docs/metrics.md" for the vault. Empty: off.
    obsidian_note: "",
  },
  // Whole-project auditors (ADR 0013): skill names run when a task's tier or
  // playbook is in triggers; saw task start lists them with their token budget.
  // Third-party auditors must be pinned in deps.lock.toml first.
  audit: {
    auditors: ["appsec-review", "dependency-audit-rules", "web-quality-audit"],
    triggers: ["critical", "hardening", "audit"],
    token_budget: 100000,
  },
  // GitHub settings as code (ADR 0015), for saw repo plan|apply. Off until enabled.
  repo: {
    enabled: false,
    merge: { squash: true, merge_commit: false, rebase: false, delete_branch_on_merge: true, auto_merge: false },
    protect: { branch: "main", require_pr: true, required_approvals: 1, required_checks: [], block_force_push: true },
    security: { secret_scanning: true, push_protection: true, dependabot_alerts: true, dependabot_fixes: true },
    labels: ["tier:trivial", "tier:standard", "tier:complex", "tier:critical"],
  },
  // saw retro: a check failing in this many tasks becomes a proposal.
  retro: { repeat_threshold: 2, proposals_dir: "docs/proposals" },
  // saw eval: before/after comparison of the eval suite (claude plugin eval).
  evals: { baseline: "evals/baseline.json", max_token_increase: 0.1, runs: 3 },
  deps: { lock: "deps.lock.toml", allowed_licences: ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"] },
  safety: {
    push: "never",
    destructive_approval: true,
    deploy_approval: true,
    no_secrets: true,
    deny: ["rm -rf", "git push --force", "curl | sh"],
  },
};

// Allowed values for enum keys; checked by `saw doctor` and `saw config set`.
export const ENUMS: Record<string, string[]> = {
  "project.type": ["web", "api", "cli", "lib", "infra"],
  "autonomy.level": ["suggest", "propose", "act"],
  "routing.default_tier": ["auto", "trivial", "standard", "complex", "critical"],
  "tokens.mode": ["soft", "hard"],
  "style.tone": ["normal", "structured", "detailed", "verbose"],
  "style.mode": ["soft", "hard"],
  "models.mode": ["single", "routed"],
  "knowledge.store": ["repo", "vault", "both"],
  "safety.push": ["never", "ask", "allow"],
};
