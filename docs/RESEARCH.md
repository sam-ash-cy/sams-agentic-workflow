# Research

Findings behind the [blueprint](BLUEPRINT.md). Each finding is labelled:

- **Primary**: read at the source.
- **Secondary**: reported by write-ups and not yet checked against the original.
- **Unverified**: a self-reported figure or vendor claim.

Phase 1 upgrades every Secondary and Unverified item, or drops it.

## 1. Compose, don't reinvent
- **mattpocock/skills** (MIT) already provides grilling, grill-with-docs (glossary + ADRs), to-spec, to-tickets, implement (tdd → code-review), implement-spec (parallel subagents), wayfinder, retro, diagnosing-bugs, research, prototype, codebase-design, domain-modeling, code-review, handoff and writing-for-agents. It installs as a Claude Code plugin, a Codex/Copilot marketplace, or through `npx skills`. *Primary:* <https://github.com/mattpocock/skills>
- **rederive** (MIT) teaches a codebase by having you re-derive its design through guided questions. It keeps its state in a git-excluded `.rederive/` folder and sends no telemetry. *Primary:* <https://github.com/EricJujianZou/rederive>
- Community setups that pair dotfiles with Obsidian: iamvirul/claude-setup and nparkison/dotclaude. *Secondary.*

## 2. Workflows before agents
- Anthropic separates *workflows* (predefined paths) from *agents* (the model directs its own process), and recommends the simplest pattern that works. Its patterns are prompt chaining, routing, parallelisation, orchestrator-workers and evaluator-optimizer. Evaluator-optimizer pays off only when the evaluation criteria are clear. *Secondary, primary at* <https://www.anthropic.com/research/building-effective-agents>
- → This is why the blueprint routes by tier, keeps the implementer in the main session, and uses subagents only where they add independence or isolate context.

## 3. Enforce mechanically
- In OpenAI's "Harness Engineering" (Feb 2026), the team built a product with agents and enforced architecture through structural tests and lint rules. Its linter error messages double as instructions for fixing the problem. *Secondary:* <https://www.infoq.com/news/2026/02/openai-harness-engineering-codex>. Read the original at openai.com/index/harness-engineering.
- CLAUDE.md is advisory context, while hooks always run. *Secondary:* <https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more>
- → Guarantees go in hooks, tests and CI. Instructions are kept short.

## 4. Context files: one standard, kept short
- AGENTS.md is a vendor-neutral format under the Linux Foundation. Codex, Cursor, Jules, Aider, Zed and others support it. *Secondary:* <https://infoq.com/news/2025/08/agents-md/>
- An ETH Zurich paper reportedly found that context files often hinder agents. *Unverified, to read in Phase 1.*
- → The template ships AGENTS.md, with CLAUDE.md as `@AGENTS.md` plus Claude-only notes. A size lint keeps both short.

## 5. Token efficiency
- Anthropic's context-engineering post covers just-in-time retrieval (glob/grep on demand), compaction and clearing old tool results. *Secondary:* <https://agentic-ai.readthedocs.io/en/latest/ContextEngineering/anthropic/>
- Common levers: a lean CLAUDE.md, a fresh session per task, `/compact`, subagents that return summaries, ignoring noisy files. *Secondary:* <https://www.kdnuggets.com/7-practical-ways-to-reduce-claude-code-token-usage>, <https://tech.autoscout24.com/blog/posts/3-techniques-to-reduce-token-consumption-claude-code-codex/>
- One benchmark reports 20–43% token reductions from tooling. Many "90%" claims come from marketing pages. *Unverified:* <https://firecrawl.dev/blog/claude-code-token-efficiency>
- Code-map and output-filtering tools: Token Pilot (outlines and symbol reads), agent-token-saver (bounded output) and CodebaseAgent-MCP (exploration delegated to a cheap model). *Unverified, self-reported:* <https://github.com/Supersynergy/agent-token-saver>, <https://pypi.org/project/codebase-agent-mcp>
- → Code-map adapter (Trail, or a fallback), `saw run` quiet output, model routing, tier budgets. In Phase 1, benchmark the tools against Trail on 3 eval tasks before adopting any.

## 6. Supply-chain risk of skills
- Datadog found a malicious skill in the wild. Dynamic-context commands can run before the model reads the skill, so model-side injection defences never see them. *Primary:* <https://securitylabs.datadoghq.com/articles/malicious-skills-supply-chain-risks-in-coding-agents-with-dynamic-context/>
- SentinelOne describes a plugin that hijacked a dependency skill. *Primary:* <https://www.sentinelone.com/blog/marketplace-skills-and-dependency-hijack-in-claude-code>
- A study reportedly found that 26% of 31k skills have at least one vulnerability. *Unverified:* <https://aiweekly.co/alerts/claude-skills-study-flags-26-vulnerability-rate>
- → Pin dependencies by SHA, review diffs on update, use a deny-list, and never let a committed project file weaken `[safety]`.

## 7. Phase 1 verification (2026-10-31, primary sources)

**Claude Code plugins** (*Primary:* <https://code.claude.com/docs/en/plugins-reference>)
- Layout: `.claude-plugin/plugin.json` with `skills/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json` and `bin/` at the plugin root.
  - `bin/` is put on the Bash PATH, so the `saw` CLI can ship inside the plugin.
  - A `CLAUDE.md` at the plugin root is **not** loaded. Instructions have to go in skills, or be installed by the bootstrap.
- `dependencies` declares other plugins that must be enabled. → mattpocock-skills can be a real plugin dependency, not only a vendored copy.
- `version` pins users to a version. `claude plugin validate --strict` is the check to run in CI.
- `userConfig` adds typed options to `/config` and stores sensitive values in the OS keychain. → It suits the few plugin-level options. Project settings stay in `workflow.toml`.
- `experimental.evals` + `claude plugin eval` is a built-in eval runner. → Use it for Tier 1 Claude evals. `saw eval` only wraps it and adds Codex.

**Subagents** (*Primary:* <https://code.claude.com/docs/en/sub-agents>)
- Frontmatter supports `model` (haiku/sonnet/opus/inherit), `tools`/`disallowedTools`, `effort`, `maxTurns`, `isolation: worktree`, `skills`, `memory` and `omitClaudeMd`. → Model routing, effort, turn caps and lean context can all be set per agent with no custom code.
- **Plugin agents ignore `hooks`, `mcpServers` and `permissionMode`.** Hooks have to live in the plugin's `hooks/hooks.json`.
- `CLAUDE_CODE_SUBAGENT_MODEL` sets one model for every subagent. This gives the `models.mode = "single"` setting.

**Hooks** (*Primary:* <https://code.claude.com/docs/en/hooks>)
- There are 33 events, including `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, `PreCompact`, `SessionStart` and `TaskCompleted`.
- A `Stop` hook can block, through exit code 2 or `{"decision":"block"}`. → The stop-verify hook is feasible as planned.

**Costs and tokens** (*Primary:* <https://code.claude.com/docs/en/costs>)
- Built in already: prompt caching, auto-compaction, deferred MCP tool definitions.
- Official advice:
  - Keep CLAUDE.md **under 200 lines** and move workflow detail into skills.
  - Use `/clear` between tasks.
  - Default to Sonnet and save Opus for architecture.
  - Use `model: haiku` for simple subagents.
  - Prefer CLI tools over MCP servers.
  - Lower `/effort` on simple tasks.
  - Delegate verbose operations to subagents.
- **Code-intelligence (LSP) plugins** give symbol navigation and type errors after each edit. → A first-party fallback when Trail is off.
- **A PreToolUse hook can rewrite test commands so only failures come back** (the docs give an example). → `saw run` should be built as this hook pattern.
- Measurement: `/usage` (attribution and recommendations), `/insights`, the status line's `prompt_cache` fields, and OpenTelemetry export. `--max-budget-usd` gives hard budgets in headless runs.
- Agent teams cost about 7× the tokens. → Keep `parallel_sessions` off by default for subagent teams.

**Context files** (*Secondary, paper* arXiv:2602.11988 *via* <https://the-decoder.com/context-files-for-coding-agents-often-dont-help-and-may-even-hurt-performance/>)
- LLM-generated AGENTS.md files *lowered* success rates in 5 of 8 settings and raised cost by 20% or more.
- Human-written files gave only about +4 points, and agents did not find the relevant files any faster.
- → **Never auto-generate AGENTS.md.** `saw init` asks questions and writes only commands and non-obvious rules, with nothing already covered in docs/. The size lint enforces this.

**OpenAI harness post**: openai.com returned 403 to the fetcher, so it stays *Secondary*. The owner should read it in a browser before Phase 3.

## Still to research (later phases)
- Benchmark the code-map options (Trail, an LSP plugin, Token Pilot) on 3 eval tasks. This needs the Phase 7 eval harness, so the item moves there.
- Claude Code docs: plugin manifest, hooks events, subagent `model` field, prompt caching, auto-compaction.
- The original OpenAI harness post and the ETH context-file paper.
- Reflexion and eval-driven skill refinement; `claude plugin eval`.
- Git worktrees with parallel agents; Codex hook/skill support for Tier 1.
