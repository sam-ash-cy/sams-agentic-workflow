# Playbook: integration (also migrations, infra)
**Enter when:** connecting an external service, changing a schema, or touching infrastructure.
**Gates:** read the provider's current docs (research); contract tests or a fake client; for migrations a working downgrade; for infra a plan/diff reviewed before apply. Migrations and infra are critical tier.
**Outputs:** ADR for the integration choice; setup steps in docs/.
**Done when:** checks pass against a fake and, where possible, the real service; rollback is written down.
