// Built-in defaults: the lowest settings layer. Every valid key appears here,
// so `saw doctor` treats any key missing from this tree as unknown.

export type Value = string | number | boolean | Value[] | Table;
export interface Table {
  [key: string]: Value;
}

export const DEFAULTS: Table = {
  features: {
    router: true,
    grilling: true,
    tdd: true,
    code_review: true,
    security_review: true,
    verify_hook: true,
    budgets: true,
    model_routing: true,
    quiet_output: true,
    trail: false,
    obsidian: true,
    rederive: false,
    metrics: true,
    dashboard: true,
    self_improve: true,
    retro: true,
    parallel_sessions: false,
    worktrees: true,
    audit: true,
  },
  project: { type: "web" },
  autonomy: {
    level: "propose",
    actions: {
      commit: "ask",
      push: "never",
      open_pr: "ask",
      spawn_sessions: "propose",
      add_dependency: "ask",
      self_improve: "propose",
      edit_global: "never",
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
    critical: { extends: "complex", run: ["e2e", "dep_audit", "threat_model"] },
  },
  context: { agents_md_max_lines: 100, claude_md_max_lines: 200 },
  output: { quiet: true, max_lines: 60, full_logs: ".saw/logs" },
  knowledge: { store: "repo", vault_path: "" },
  metrics: { fields: ["tier", "verification", "findings", "rework", "tokens"] },
  dashboard: {
    panels: ["first_pass_rate", "findings_by_category", "rework", "cost_per_task", "promotion_effect"],
  },
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
  "models.mode": ["single", "routed"],
  "knowledge.store": ["repo", "vault", "both"],
  "safety.push": ["never", "ask", "allow"],
};
