You are planning, not building. Goal:

{{goal}}

1. Read the repo's docs first: README, AGENTS.md / CLAUDE.md, docs/ (especially docs/decisions/ and docs/plans/) and the existing queue at {{queue}}.
2. For each decision the goal needs, write an ADR draft at `docs/decisions/NNNN-title.md` (next free number, kebab-case title) with `status: proposed`, covering context, options, the decision and its consequences.
3. Write or update `docs/plans/roadmap.md`: the stages towards the goal and how they depend on each other.
4. Append queue items to {{queue}} in this format, one per unit of work small enough for one session:

```
- [proposed] slug: what to build
  - tier: trivial|standard|complex|critical
  - needs: slug-a, slug-b
  - accept: one acceptance criterion per line
  - adr: docs/decisions/NNNN-title.md
```

   Every item is `[proposed]`, has a unique slug, a `tier`, `needs` naming only slugs that exist in the queue (omit the line if none, no cycles), at least one `accept` line, and its `adr` when there is one.

Rules: never write `[approved]` (only the owner approves), never change items already in the queue, never edit code, tests or config, never commit, push or open a PR. Finish with a short summary of what you wrote.
