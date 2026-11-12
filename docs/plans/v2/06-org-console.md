# Plan 06 — Org Console (2.0.0-beta.6)

**Goal:** see and manage the whole organisation in the Claude Code pane or a browser. Every control is one click.
**Depends on:** 02, 05. Fuller with 03. **Tier:** complex, design playbook.

## Design

Extend `dashboard-server.ts`, `dashboard-page.ts`, `dashboard-script.ts` and the `dashboard-pane` mod. No new stack, no build step. The same page serves both surfaces.

**Rule:** the console holds no logic. Each control calls a JSON endpoint that runs the same function as the matching `saw` command. Anything doable in the UI is doable in the CLI, and by an agent.

### Views

| View | Shows | Actions |
|---|---|---|
| **Home** | scope switcher (global / business / project), what is running, what waits on you, spend today | start, pause, stop the org |
| **Org chart** | teams and roles as a tree from `reports_to`; runner, model and status per role | add, clone, disable, re-parent a role |
| **Agent editor** | one role: duties, model, effort, runner, grants, paths, autonomy, budget | form with live schema validation; raw file tab |
| **Board** | items by stage (kanban) or by goal (tree) | create a goal, reprioritise, reassign, cancel |
| **Feed** | threads, filterable by item, role, type | reply as `human`, ack, escalate |
| **Approvals** | every `waiting_human` gate with its evidence: diff, ADR, checks, cost | approve, reject with a note, ask a question |
| **Connectors** | installed, catalogue search, grants matrix (role × connector) | add, remove, grant, revoke |
| **Runners** | availability and health of each runner; cloud and worker status | enable, set default per team |
| **Process** | the stage graph, with gates | change a gate, add a stage, within autonomy limits |
| **Costs** | tokens and USD by role, team, item, day | set budgets |
| **Settings** | existing dashboard settings, plus the `[org]` keys | as today |

Live updates: the server tails the bus and pushes server-sent events. Fall back to polling if SSE is blocked in the pane.

### Safety of the UI

- Bind to `127.0.0.1` only, with a per-start token and an Origin check. A local page that can change autonomy must not be reachable by other sites. Check what the current server does; keep or add this.
- Guardrail controls show the effective value and which layer set it. Loosening is offered only at a layer allowed to loosen.
- Approve stays disabled until the evidence has loaded.

### Design intake (pause condition)

Global rules require a design reference before frontend work. None exists for these views. Before building: produce 2–3 directions as static prototypes on the existing dashboard tokens, get one picked, record it as an ADR. Do not invent spacing, colour or copy outside the existing token set.

## Expected touch points

New: `cli/src/console/{api,sse,views/*}.ts`.
Changed: `dashboard-server.ts`, `dashboard-page.ts`, `dashboard-script.ts`, `dashboard-settings.ts`, `dashboard.ts`, `mods/dashboard-pane`, `mods/workflow-pane`.

## Steps

1. Design directions and owner pick. ADR.
2. JSON API over kernel functions.
3. SSE feed.
4. Views in order: Home, Board, Feed, Approvals, Org chart, Agent editor, Connectors, Runners, Process, Costs.
5. Pane integration and narrow-width layout.
6. Accessibility, keyboard and contrast pass. ui-verifier screenshots.

## Testing

- API contract tests per route: valid request, invalid body, missing token, wrong Origin.
- A test that diffs the API route table against the CLI command list.
- View logic as pure functions (bus state → view model) with unit tests.
- Browser: ui-verifier at mobile and desktop widths; axe on every view; keyboard-only walkthrough of approve and edit-role.
- Human-only check, named: visual pass in the Claude Code pane and in the desktop app.

## Acceptance criteria

- Each UI action has a matching CLI command.
- Editing a role in the UI yields a file that passes `saw org lint`; an invalid form cannot be saved.
- A request without the token, or from another origin, is refused.
- An approval in the UI appears as a `decision` message from `human` and moves the item.
- No console errors; axe checks pass on every view (WCAG 2.2 AA).

## Open questions

- Mod bands and panes do not draw in the desktop app (per FEATURES.md). Confirm whether the dashboard pane does; if not, the browser is the desktop surface.
- Drag-and-drop on the org chart without a library: recommend select-to-reparent first.
