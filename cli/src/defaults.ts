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
    compact_nudge: true,
    style_hook: true,
    format_hook: true,
    trail: false,
    obsidian: true,
    metrics: true,
    dashboard: true,
    retro: true,
    audit: true,
    // saw task start suggests them; saw guard denies
    // `git worktree add` / `claude -p` when off.
    worktrees: true,
    parallel_sessions: false,
    // Never work on [branch].base: saw task start branches (or opens a
    // worktree) off it, saw guard denies commits there and edits during a
    // non-trivial task.
    branch_guard: true,
    // Third-party UI polish skill (deps.lock.toml): a design-playbook step when
    // on; saw sync denies the skill when off.
    unslop: false,
    // Third-party launch-video skill (deps.lock.toml): an optional step after a
    // feature or foundation PR merges; saw sync denies it when off.
    brag: false,
    // feature and foundation tasks end with a docs step (Diataxis split).
    docs_step: true,
    // saw task end flags docs still blank in a project with code, and command,
    // config or API changes without a docs/reference change; the docs step also
    // covers debug, integration and hardening tasks.
    living_docs: true,
    // Standard-or-higher tasks: the session plans and reviews; the implementer
    // agent (models.roles.implement) writes each planned unit.
    implementer: false,
    // SessionStart adds a summary of the about-me profile (~/.saw/about-me.md,
    // docs/about-me.md, .saw/about-me.local.md) to the session's context.
    about_me: true,
    // UserPromptSubmit suggests missing MCP servers and skills from
    // recommendations.toml when the prompt or project needs them.
    recommend: true,
    // saw task end suggests up to 3 catalog skills that fit the finished task.
    skill_finder: true,
    // Claude Code's built-in advisor (advisorModel, written by saw sync) is on,
    // and standard-or-higher tasks owe an advisor check before the PR.
    advisor: true,
    // saw task start names the skills that fit the task's playbook ([task_skills]),
    // to run where they help, and how to install the ones missing.
    task_skills: true,
  },
  // features.task_skills: skills per playbook for standard-or-higher tasks;
  // "plan" applies to every complex or critical task.
  task_skills: {
    plan: ["mattpocock-skills:grilling", "engineering:architecture"],
    foundation: ["engineering:system-design", "mattpocock-skills:codebase-design"],
    design: ["frontend-design:frontend-design", "design:design-critique", "web-design-guidelines"],
    feature: ["mattpocock-skills:tdd", "engineering:testing-strategy"],
    integration: ["api-design-rules", "engineering:testing-strategy"],
    debug: ["mattpocock-skills:diagnosing-bugs", "engineering:debug"],
    spike: ["mattpocock-skills:prototype", "mattpocock-skills:research"],
    hardening: ["appsec-review", "engineering:tech-debt"],
    audit: ["engineering:code-review", "appsec-review"],
  },
  // features.advisor: the model the advisor tool asks (global or project layer).
  advisor: { model: "claude-opus-5-5" },
  // auto: the agent offers to run `saw recommend add <id>` once the user agrees;
  // manual: it only shows the install command.
  recommend: { mode: "auto", mcp: true, skills: true },
  // Skills that must run before a PR, e.g. ["security-review", "simplify"]. Each
  // becomes a required check (skill:<name>) recorded with saw task record.
  pre_pr: { skills: [], tiers: ["standard", "complex", "critical"] },
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
  // features.branch_guard: the branch to branch off (global or project layer).
  // One switch for the six enforcement modes: strict sets routing, verify, tdd, tokens, style and
  // sessions .mode to hard, relaxed sets them to soft, custom (the default) leaves each to its own key.
  // A guardrail: workflow.toml can raise it to strict, only your own layers can relax it.
  enforcement: "custom",
  // mode auto: a worktree for complex and critical tasks (features.worktrees), a branch otherwise.
  branch: { base: "main", mode: "auto" },
  // routing.mode hard (opt-in; features.verify_hook): saw guard denies edits to files in a saw project
  // until a task is open (router skill, then `saw task start` or `saw task adhoc`). soft = nudges only.
  // The tier floor: a task is at least standard past trivial_max_files files or trivial_max_lines changed lines
  // since it started, and critical when a changed path matches a critical_paths glob.
  routing: {
    default_tier: "auto",
    always_grill: ["complex", "critical"],
    mode: "soft",
    // With no task open, the UserPromptSubmit hook classifies the prompt by fixed rules (cli/src/auto-route.ts,
    // no model call). suggest: the router nudge proposes the saw task start line. open: it opens a provisional
    // task the agent confirms with saw task retier or saw task start before verify lets a commit through. off: neither.
    auto: "suggest",
    trivial_max_files: 3,
    trivial_max_lines: 60,
    critical_paths: ["**/auth/**", "**/*secret*", "**/migrations/**", "infra/**", "**/*.tf", ".github/workflows/**"],
  },
  // features.tdd: mode hard = on standard-or-higher tasks in these playbooks, saw
  // guard denies code edits (tests excepted) until `saw run test` has failed since
  // the task started. Needs [checks].test. soft = the step only.
  tdd: { mode: "hard", playbooks: ["feature", "foundation", "integration", "debug"] },
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
    // What `saw task record code_review|security_review pass` needs besides the
    // agent's word: "off" nothing; "agent" a review report from this task (a saw
    // review-session, or a reviewer subagent's report saved under .saw/reviews/
    // and passed with --report); "review_session" a saw review-session only.
    // A guardrail: workflow.toml can raise it, only your own layers can lower it.
    require_review_evidence: "off",
    // mode hard (opt-in; features.verify_hook): saw guard denies git commit, git push and gh pr create
    // while the open task isn't Verified, or its tier is below the diff's floor (routing.trivial_max_*,
    // routing.critical_paths). soft = the Stop gate only. A guardrail: workflow.toml can raise it, only your own layers can lower it.
    mode: "soft",
    // Required mechanical checks that may have no [checks] command without blocking
    // Verified. Any other required check with no command makes a task "Not verified".
    allow_unconfigured: [],
    trivial: { run: ["test"] },
    standard: { run: ["format", "lint", "typecheck", "test", "code_review", "security_review", "advisor", "docs"] },
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
    // Claude Code's own auto-compact, written by saw sync: "inherit" leaves
    // autoCompactEnabled alone, "on"/"off" set it. autocompact_window (tokens,
    // 100000-1000000) sets autoCompactWindow; 0 leaves it alone. Global layer:
    // saw sync --global writes ~/.claude/settings.json; else .claude/settings.local.json.
    autocompact: "inherit",
    autocompact_window: 0,
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
  // One session per unit of work: saw session-hook steps in when a session that
  // finished a unit (commit or PR) starts another of these kinds. [] = off.
  sessions: { new_per: ["phase", "stage", "feature"], mode: "soft" },
  // Independent audit session per unit of work: before the PR of a `when` unit,
  // saw review-session runs a fresh read-only reviewer. budget 0 = tier skipped.
  review_session: {
    enabled: false,
    when: ["feature", "phase", "stage"],
    mode: "both",
    budget_by_tier: { trivial: 0, standard: 40000, complex: 80000, critical: 150000 },
  },
  // saw autopilot: owner-approved queue items, one headless session,
  // branch and PR each, under hard caps. Opt-in; never merges or deploys.
  autopilot: {
    enabled: false,
    queue: "docs/plans/queue.md",
    per_item_usd: 5,
    max_total_usd: 30,
    max_failures: 2,
    max_wait: "6h",
    resume_on_limit: true,
    // [proposed] items whose `tier:` is listed run as approved. complex and
    // critical are ignored here: they always need the owner.
    auto_approve_tiers: [] as string[],
  },
  // saw plan: one headless session turns a goal into ADR drafts, a roadmap
  // and [proposed] queue items. Never approves, edits code or commits.
  plan: { max_usd: 3 },
  // vault_path: the central personal vault (absolute; global or local layer only).
  knowledge: { store: "repo", vault_path: "" },
  // saw sanitize: extra names of yours to flag before going public, besides git
  // user.name/email and the OS user (global or local layer only).
  // flow: "main" releases and tags on main; "release-branch" cuts on
  // release/vX.Y.Z or hotfix/*, and saw release tag tags main after the merge.
  release: { names: [], flow: "main" },
  // Agents this project supports; saw agents check verifies each reads AGENTS.md.
  agents: { enabled: ["claude"] },
  // Workflow event log (.saw/events.jsonl): tier picks, gate blocks/passes,
  // guard denies/rewrites, budget warnings, review sessions, saw run results.
  // level: "debug" adds chatty events (format-hook runs), "info" is the normal
  // timeline, "warn" keeps only blocks, denies, failures and budget warnings.
  logging: { enabled: true, level: "info" },
  dashboard: {
    panels: ["outcomes", "first_pass_rate", "findings_by_category", "rework", "cost_per_task", "promotion_effect", "adoption", "events", "autopilot"],
    // saw dashboard --serve: port on 127.0.0.1, and how many recent events the timeline shows.
    port: 4173,
    events_limit: 50,
    output: ".saw/dashboard.html",
    // Also write the panels as a Markdown note, e.g. "docs/metrics.md" for the vault. Empty: off.
    obsidian_note: "",
  },
  // Whole-project auditors: skill names run when a task's tier or
  // playbook is in triggers; saw task start lists them with their token budget.
  // Third-party auditors must be pinned in deps.lock.toml first.
  audit: {
    auditors: ["appsec-review", "dependency-audit-rules", "web-quality-audit"],
    triggers: ["critical", "hardening", "audit"],
    token_budget: 100000,
  },
  // GitHub settings as code, for saw repo plan|apply. Off until enabled.
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
  deps: { lock: "deps.lock.toml", allowed_licences: ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "CC-BY-4.0"] },
  safety: {
    push: "never",
    destructive_approval: true,
    deploy_approval: true,
    no_secrets: true,
    deny: ["rm -rf", "git push --force", "git push -f", "curl | sh"],
  },
};

// Allowed values for enum keys; checked by `saw doctor` and `saw config set`.
export const ENUMS: Record<string, string[]> = {
  enforcement: ["custom", "strict", "relaxed"],
  "recommend.mode": ["auto", "manual"],
  "project.type": ["web", "api", "cli", "lib", "infra"],
  "autonomy.level": ["suggest", "propose", "act"],
  "branch.mode": ["branch", "worktree", "auto"],
  "routing.default_tier": ["auto", "trivial", "standard", "complex", "critical"],
  "tokens.mode": ["soft", "hard"],
  "routing.mode": ["soft", "hard"],
  "routing.auto": ["off", "suggest", "open"],
  "verify.mode": ["soft", "hard"],
  "tdd.mode": ["soft", "hard"],
  "verify.require_review_evidence": ["off", "agent", "review_session"],
  "style.tone": ["normal", "structured", "detailed", "verbose"],
  "style.mode": ["soft", "hard"],
  "sessions.mode": ["soft", "hard"],
  "review_session.mode": ["grill", "audit", "both"],
  "models.mode": ["single", "routed"],
  "knowledge.store": ["repo", "vault", "both"],
  "release.flow": ["main", "release-branch"],
  "safety.push": ["never", "ask", "allow"],
  "logging.level": ["debug", "info", "warn"],
  "context.autocompact": ["inherit", "on", "off"],
};

// One plain sentence per key, shown beside it in the settings dashboard. A test fails when a
// key above has none (and when one stays after its key is gone).
export const DESCRIPTIONS: Record<string, string> = {
  "features.grilling": "Questions the agent asks you before it plans a complex or critical task.",
  "features.tdd": "Write a failing test before the code on standard and bigger tasks.",
  "features.code_review": "A code review is a required check before a task counts as verified.",
  "features.security_review": "A security review is a required check before a task counts as verified.",
  "features.verify_hook": "Block the agent from stopping while the task is not verified.",
  "features.budgets": "Warn when a task uses more tokens than its tier allows.",
  "features.compact_nudge": "Suggest compacting the conversation when the context window fills up.",
  "features.style_hook": "Check replies against the tone and word limit in [style].",
  "features.format_hook": "Run the project formatter after each edit.",
  "features.trail": "Look up code with Trail (code map) before reading files.",
  "features.obsidian": "Allow notes and learnings to be written to your Obsidian vault.",
  "features.metrics": "Record one line of metrics per finished task in .saw/metrics.jsonl.",
  "features.dashboard": "Allow saw dashboard to build this page and the static report.",
  "features.retro": "Allow saw retro to turn repeated check failures into proposals.",
  "features.audit": "Suggest whole-project auditors on critical, hardening and audit tasks.",
  "features.worktrees": "Allow separate git worktrees for big tasks. Off: saw guard denies git worktree add.",
  "features.parallel_sessions": "Allow the agent to start other Claude sessions. Off: saw guard denies them.",
  "features.branch_guard": "Never work on the base branch: tasks branch off it and commits there are denied.",
  "features.unslop": "Add the unslop skill as a step in the design playbook.",
  "features.brag": "Offer a launch-video step after a feature or foundation PR merges.",
  "features.docs_step": "Feature and foundation tasks end with a docs step.",
  "features.living_docs": "Flag blank docs, and code changes that come with no docs change.",
  "features.implementer": "A separate implementer agent writes each planned unit; the main session plans and reviews.",
  "features.about_me": "Add a summary of your about-me profile to each session's context.",
  "features.recommend": "Suggest MCP servers and skills when the prompt or project needs them.",
  "features.skill_finder": "When a task ends, suggest up to three catalog skills that fit it.",
  "features.advisor": "Use Claude Code's advisor model, and require an advisor check before a PR.",
  "features.task_skills": "Name the skills that fit the task's playbook when it starts.",
  "task_skills.plan": "Skills for every complex or critical task.",
  "task_skills.foundation": "Skills for foundation tasks.",
  "task_skills.design": "Skills for design tasks.",
  "task_skills.feature": "Skills for feature tasks.",
  "task_skills.integration": "Skills for integration tasks.",
  "task_skills.debug": "Skills for debug tasks.",
  "task_skills.spike": "Skills for spike tasks.",
  "task_skills.hardening": "Skills for hardening tasks.",
  "task_skills.audit": "Skills for audit tasks.",
  "advisor.model": "The model the advisor asks.",
  "recommend.mode": "auto: the agent offers to install a recommendation. manual: it only shows the command.",
  "recommend.mcp": "Recommend MCP servers.",
  "recommend.skills": "Recommend skills.",
  "pre_pr.skills": "Skills that must run before a PR. Each becomes a required check.",
  "pre_pr.tiers": "The tiers the pre-PR skills apply to.",
  "project.type": "What kind of project this is. Picks the default checks and playbooks.",
  "autonomy.level": "How much the agent does without asking: suggest, propose or act.",
  "autonomy.actions.commit": "Committing: never, ask, propose or allow.",
  "autonomy.actions.push": "Pushing: never, ask, propose or allow.",
  "autonomy.actions.open_pr": "Opening a pull request: never, ask, propose or allow.",
  "autonomy.actions.add_dependency": "Adding a dependency: never, ask, propose or allow.",
  "autonomy.actions.self_improve": "Changing the workflow's own rules or skills: never, ask, propose or allow.",
  "autonomy.actions.edit_global": "Editing your global Claude or saw settings: never, ask, propose or allow.",
  "autonomy.actions.spawn_sessions": "Starting other sessions: never, ask, propose or allow.",
  enforcement: "One switch for the six mode keys. strict makes them all hard, relaxed all soft, custom leaves each as set.",
  "branch.base": "The branch tasks branch off and never edit directly.",
  "branch.mode": "Where a task works: a branch, a worktree, or auto (worktree for complex and critical).",
  "routing.default_tier": "The tier for a task when the agent is not told one. auto lets it classify.",
  "routing.always_grill": "Tiers that always get questions before planning.",
  "routing.mode": "hard: no edits to project files until a task is open. soft: a reminder only.",
  "routing.auto": "With no task open: suggest a task line, open one for the agent to confirm, or do nothing.",
  "routing.trivial_max_files": "A task that changes more files than this is at least standard.",
  "routing.trivial_max_lines": "A task that changes more lines than this is at least standard.",
  "routing.critical_paths": "A change to a file matching one of these globs makes the task critical.",
  "tdd.mode": "hard: code edits are denied until a test has failed since the task started. soft: a step only.",
  "tdd.playbooks": "Playbooks that need a failing test first.",
  "tokens.mode": "hard: stop at the token budget. soft: warn only.",
  "tokens.warn_at": "Share of the budget at which to warn, from 0 to 1.",
  "tokens.budget.trivial": "Token budget for a trivial task.",
  "tokens.budget.standard": "Token budget for a standard task.",
  "tokens.budget.complex": "Token budget for a complex task.",
  "tokens.budget.critical": "Token budget for a critical task.",
  "models.mode": "single: every agent inherits the session model. routed: each role uses its own tier.",
  "models.cheap": "The model for the cheap tier.",
  "models.mid": "The model for the mid tier.",
  "models.strong": "The model for the strong tier.",
  "models.roles.explore": "Tier for exploring the code.",
  "models.roles.research": "Tier for research.",
  "models.roles.implement": "Tier for writing code.",
  "models.roles.architect": "Tier for design decisions.",
  "models.roles.review": "Tier for code review.",
  "models.roles.security_review": "Tier for security review.",
  "models.roles.ui_verify": "Tier for checking a UI in a browser.",
  "verify.require_review_evidence": "What a review check needs besides the agent's word: nothing, a report from this task, or a review session.",
  "verify.mode": "hard: commit, push and PR are denied until the task is verified. soft: the stop gate only.",
  "verify.allow_unconfigured": "Required checks that may have no command without blocking verified.",
  "verify.trivial.run": "Checks a trivial task needs.",
  "verify.standard.run": "Checks a standard task needs.",
  "verify.complex.extends": "The tier whose checks a complex task starts from.",
  "verify.complex.run": "Checks a complex task needs on top of that tier.",
  "verify.critical.extends": "The tier whose checks a critical task starts from.",
  "verify.critical.run": "Checks a critical task needs on top of that tier.",
  "context.agents_md_max_lines": "Longest AGENTS.md saw lint-context accepts.",
  "context.claude_md_max_lines": "Longest CLAUDE.md saw lint-context accepts.",
  "context.window_tokens": "Size of the context window, in tokens.",
  "context.suggest_compact_at": "Shares of the window at which to suggest compacting, each once per session.",
  "context.handoff_at": "Share of the window at which to write a handoff note.",
  "context.autocompact": "Claude Code's auto-compact: inherit leaves it alone, on or off sets it.",
  "context.autocompact_window": "Tokens at which auto-compact starts, 100000 to 1000000. 0 leaves it alone.",
  "output.quiet": "Show only a short result for checks; the full log goes to a file.",
  "output.max_lines": "Most lines of a check's output to show.",
  "output.full_logs": "Folder for the full logs.",
  "output.rewrite_commands": "Run a command that is exactly a configured check as saw run instead.",
  "style.tone": "Shape of replies: normal, structured, detailed or verbose.",
  "style.max_words": "Longest reply in words. Code blocks do not count.",
  "style.by_tier.trivial": "Word limit for trivial tasks. 0 uses max_words.",
  "style.by_tier.standard": "Word limit for standard tasks. 0 uses max_words.",
  "style.by_tier.complex": "Word limit for complex tasks. 0 uses max_words.",
  "style.by_tier.critical": "Word limit for critical tasks. 0 uses max_words.",
  "style.mode": "hard: a reply over the limit is blocked. soft: a reminder only.",
  "sessions.new_per": "Kinds of work that get a fresh session after the last one finished a unit.",
  "sessions.mode": "hard: block continuing in the old session. soft: a reminder only.",
  "review_session.enabled": "Run a fresh read-only reviewer session before a PR.",
  "review_session.when": "Units of work that get a review session.",
  "review_session.mode": "What the reviewer does: question the plan, audit the diff, or both.",
  "review_session.budget_by_tier.trivial": "Token budget for the review of a trivial task. 0 skips it.",
  "review_session.budget_by_tier.standard": "Token budget for the review of a standard task. 0 skips it.",
  "review_session.budget_by_tier.complex": "Token budget for the review of a complex task. 0 skips it.",
  "review_session.budget_by_tier.critical": "Token budget for the review of a critical task. 0 skips it.",
  "autopilot.enabled": "Allow saw autopilot to work through your approved queue, one headless session per item.",
  "autopilot.queue": "File that holds the approved queue.",
  "autopilot.per_item_usd": "Most it may spend on one item, in dollars.",
  "autopilot.max_total_usd": "Most it may spend in one run, in dollars.",
  "autopilot.max_failures": "Stop after this many failed items.",
  "autopilot.max_wait": "Longest wait for a usage limit to reset, such as 6h.",
  "autopilot.resume_on_limit": "Wait and carry on after a usage limit instead of stopping.",
  "plan.max_usd": "Most saw plan's planning session may spend, in dollars.",
  "autopilot.auto_approve_tiers": "Tiers whose [proposed] queue items run without your approval: trivial, standard. complex and critical are never auto-approved.",
  "knowledge.store": "Where learnings are kept: in the repo, in your vault, or both.",
  "knowledge.vault_path": "Absolute path of your vault. Set it in the global or only-me layer.",
  "release.names": "Extra names of yours that saw sanitize flags before a repo goes public.",
  "release.flow": "main: release and tag on main. release-branch: cut on release/vX.Y.Z or hotfix/*.",
  "agents.enabled": "Coding agents this project supports. saw agents check verifies each reads AGENTS.md.",
  "logging.enabled": "Write the event log to .saw/events.jsonl.",
  "logging.level": "debug adds chatty events, info is the normal timeline, warn keeps only blocks and failures.",
  "dashboard.panels": "Statistics panels to show, in order.",
  "dashboard.port": "Port for saw dashboard --serve on 127.0.0.1.",
  "dashboard.events_limit": "How many recent events the timeline shows.",
  "dashboard.output": "Where saw dashboard writes the static page.",
  "dashboard.obsidian_note": "Also write the panels as a Markdown note at this path. Empty: off.",
  "audit.auditors": "Skills that audit the whole project.",
  "audit.triggers": "Tiers and playbooks that run the auditors.",
  "audit.token_budget": "Token budget for the auditors.",
  "repo.enabled": "Allow saw repo to plan and apply the GitHub settings below.",
  "repo.merge.squash": "Allow squash merges.",
  "repo.merge.merge_commit": "Allow merge commits.",
  "repo.merge.rebase": "Allow rebase merges.",
  "repo.merge.delete_branch_on_merge": "Delete the branch after its PR merges.",
  "repo.merge.auto_merge": "Allow auto-merge on PRs.",
  "repo.protect.branch": "The branch to protect.",
  "repo.protect.require_pr": "Changes to that branch need a pull request.",
  "repo.protect.required_approvals": "Approvals a PR needs before it can merge.",
  "repo.protect.required_checks": "CI checks that must pass before merging.",
  "repo.protect.block_force_push": "Block force pushes to that branch.",
  "repo.security.secret_scanning": "Turn on GitHub secret scanning.",
  "repo.security.push_protection": "Block pushes that contain a secret.",
  "repo.security.dependabot_alerts": "Turn on Dependabot alerts.",
  "repo.security.dependabot_fixes": "Turn on Dependabot security updates.",
  "repo.labels": "Labels the repo should have.",
  "retro.repeat_threshold": "A check that fails in this many tasks becomes a proposal.",
  "retro.proposals_dir": "Folder for retro proposals.",
  "evals.baseline": "File with the eval results to compare against.",
  "evals.max_token_increase": "Largest rise in tokens, as a share, before saw eval reports a regression.",
  "evals.runs": "How many times to run each eval.",
  "deps.lock": "File that pins third-party skills and plugins.",
  "deps.allowed_licences": "Licences allowed for dependencies.",
  "safety.push": "Pushing to a remote: never, ask or allow.",
  "safety.destructive_approval": "Always ask before destructive commands such as git reset --hard.",
  "safety.deploy_approval": "Always ask before deploy commands.",
  "safety.no_secrets": "Block commands that read or copy secrets files.",
  "safety.deny": "Command fragments that are always blocked.",
};
