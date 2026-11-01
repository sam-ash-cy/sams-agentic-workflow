# Playbook: hardening (security, performance, dependencies, release)
**Enter when:** a hardening stage, before a release, or with any critical-tier task.
**Gates:** threat model; dependency audit; secret scan; performance baseline if relevant; the audit playbook's auditors ([audit] in workflow.toml).
**Outputs:** findings in docs/audits/; fixes or a written reason each one doesn't apply.
**Done when:** no unaddressed confirmed findings; the release checklist passes.
