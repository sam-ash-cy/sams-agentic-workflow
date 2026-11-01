# sams-agentic-workflow

A configurable, token-light agentic workflow for Claude Code and other coding agents: tiered task routing, verification as a first-class step, review gates, and self-improvement driven by evidence. It ships as a Claude Code plugin plus `saw`, a dependency-free TypeScript CLI run with bun.

- **Start here:** [GETTING_STARTED.md](GETTING_STARTED.md)
- **Design and roadmap:** [docs/BLUEPRINT.md](docs/BLUEPRINT.md), with the reasons in [docs/decisions/](docs/decisions/)
- **All commands:** `saw help`

Tests: `bun test`. Licence: [MIT](LICENSE).

## Third-party skills
saw doesn't copy these into the repo. They are pinned by commit in `deps.lock.toml` and keep their own licences:
- [mattpocock/skills](https://github.com/mattpocock/skills) (MIT)
- [rederive](https://github.com/EricJujianZou/rederive) (MIT)
- [unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky (CC BY 4.0), optional UI polish (`features.unslop`)
