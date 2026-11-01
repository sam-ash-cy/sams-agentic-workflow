# sams-agentic-workflow

A configurable, token-light agentic workflow for Claude Code and other coding agents: tiered task routing, verification as a first-class step, review gates, guardrails enforced by hooks, and self-improvement driven by evidence. It ships as a Claude Code plugin plus `saw`, a dependency-free TypeScript CLI run with bun.

The docs follow the Diátaxis split:
- **Tutorial:** [Getting started](docs/tutorials/getting-started.md), a ten-minute walkthrough
- **How-to:** [install, update, uninstall](docs/how-to/install.md) · [set it up with one prompt](docs/how-to/ai-setup.md) · [configure it](docs/how-to/configuration.md) · [configure for a goal](docs/how-to/configure-for-goals.md) (automation, saving tokens, agent workflows, safety)
- **Reference:** [features](docs/reference/features.md) · [recommended settings](docs/reference/profiles.md) (solo, team, strict, autopilot) · `saw help`
- **Explanation:** [how it works and why](docs/explanation/how-it-works.md)

Tests: `bun test`. Licence: [MIT](LICENSE).

## Third-party skills
saw doesn't copy these into the repo. They are pinned by commit in `deps.lock.toml` and keep their own licences:
- [mattpocock/skills](https://github.com/mattpocock/skills) (MIT), installed as a plugin dependency
- [unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky (CC BY 4.0), optional UI polish (`features.unslop`)
- [brag](https://github.com/latent-spaces/brag) by Shunit Haviv Hakimi (MIT), optional launch videos (`features.brag`). Its bundled music is CC BY 4.0 by [Sascha Ende](https://ende.app): credit him wherever you publish a video made with it.
- [ECC](https://github.com/affaan-m/ECC) by Affaan Mustafa (MIT), optional Claude Code plugin (`features.ecc`): strategic-compact, context-budget and verification-loop. saw recommends turning off its GateGuard and duplicate hooks ([install.md](docs/how-to/install.md#4-optional-extras)).
