# Plan 10 — One-click setup and customisation (2.0.0-beta.10)

**Goal:** anyone goes from nothing to a working team for their business, project or feature in one command or one click, then changes anything without reading docs.
**Depends on:** 06, 09. **Tier:** complex.

## Design

### `saw setup`

One guided flow, in the terminal, the `/workflow-setup` skill, or the Console. Same questions, same result.

1. **What are you building?** a feature in this repo · a project · a business (several projects and teams).
2. **Pick a preset.**

| Preset | Team | Gates | Runners |
|---|---|---|---|
| `solo-feature` | lead, implementer, reviewer | merge | local |
| `solo-builder` | engineering + operations | design, merge, release | local + cloud |
| `startup` | engineering, operations, product, marketing, support, leadership | design, merge, release, all outward | local + cloud |
| `agency` | engineering per client project, shared design and leadership | per-client approvals | local + cloud |
| `enterprise` | all packs, strict enforcement, review evidence required | every stage | worker |
| `custom` | choose packs, roles, gates and runners | choose | choose |

3. **How hands-on?** `watch` (ask before most actions) · `gated` (default) · `trusted` (auto within budgets, except outward actions). Maps to `[autonomy]` and the process gates.
4. **Budget.** Daily cap per business or project.
5. **Connect tools.** Suggested connectors for the chosen packs; install now or skip.
6. **Review and apply.** Shows the exact files and keys it will write. Nothing is written before confirm.

Presets extend `profiles.ts` (`saw profile apply`); the existing `solo|team|strict|autopilot` profiles keep working. `saw setup --preset startup --yes` is the non-interactive form.

### Customising

- **Role builder.** `saw role new` (or the Agent editor): describe the job in a sentence, pick a base role to clone, and it scaffolds a valid role file. A drafting agent may fill the prose; the kernel validates the frontmatter.
- **Scope of an edit.** Every change asks, or takes `--scope`: just me here · this project · this business · everywhere. `saw explain` shows the winning layer.
- **Gallery.** Browse roles, teams, processes and packs with previews; install or clone to edit.
- **Process editor.** Add, remove or reorder stages and change gates, with the graph validated on save.
- **Agents managing the org.** An `org-admin` role may propose roles, teams, board changes and budgets through the same commands. Its changes to roles, processes and budgets go to Approvals. It can never touch `[safety]`, `[autonomy]` or its own grants.
- **Export and share.** `saw org export` writes the org as a pack, sanitised, to reuse elsewhere.

### Safety net

- `saw setup` is idempotent and prints a diff on re-run.
- `saw org doctor` reports missing connectors, unreachable runners, roles with no eval, gates with no owner, and budgets unset.
- `saw org undo` restores the previous config snapshot.

## Expected touch points

New: `cli/src/setup.ts`, `cli/src/org/{preset,role-builder,export,doctor,snapshot}.ts`, `templates/presets/*.toml`, `templates/packs/core/roles/org-admin.md`.
Changed: `profiles.ts`, `init.ts`, `skills/workflow-setup`, `skills/saw-settings`, `docs/STARTUP.md`, `bootstrap.sh`, `bootstrap.ps1`, Console views from plan 06.

## Steps (failing test first where code changes)

1. Preset format and loader on top of profiles.
2. `saw setup` flow as a pure plan builder (`answers → file changes`), then the apply step.
3. Snapshots and `saw org undo`.
4. `saw org doctor`.
5. Role builder and gallery.
6. `org-admin` role with its restricted grants.
7. `saw org export`.
8. Console wizard, reusing the same plan builder.
9. Skill and docs updates.

## Testing

- Unit: each preset resolves to a config that passes `saw org lint` and `saw doctor`.
- Golden files: `answers → file changes` for every preset.
- Idempotence: apply twice, second diff is empty.
- Undo: apply, undo, tree equals the starting tree.
- Guard: `org-admin` attempting to edit `[safety]`, `[autonomy]` or its own role is denied.
- Fresh-machine test in a container: bootstrap, `saw setup --preset solo-feature --yes`, `saw goal "..."` reaches a first handoff with the fake runner.
- Human-only check, named: a first-time user completes setup from the README with no help.

## Acceptance criteria

- From a clean repo, one command yields a team that passes `saw org doctor`.
- Every preset is covered by a golden test.
- No file is written before the confirm step.
- `org-admin` cannot change guardrails or its own grants.
- Time from bootstrap to first handoff is recorded in the eval and stays under a set bound.

## Open questions

- Preset names and contents are a product decision. Confirm the six above.
- Should the role builder's drafting agent be on by default? It costs tokens. Recommend on, with a template-only fallback.
