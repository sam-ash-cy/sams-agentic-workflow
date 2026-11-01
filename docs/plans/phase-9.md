# Phase 9: response style and length

## Goal
Replies have a predictable shape and length. One setting picks the tone, another caps the prose, and a Stop hook catches a reply that runs over.

## Built
- **`[style]` settings** (same layers as everything else):
  - `tone = "normal" | "structured" | "detailed" | "verbose"` (default `normal`). `structured`: bullets and tables, little prose. `detailed`: explains reasoning and trade-offs. `verbose`: full context and walkthroughs.
  - `max_words = 250`: cap on a reply's prose. Fenced code blocks (diffs and pasted tool output included) and inline code don't count.
  - `by_tier = { trivial = 80, standard = 0, complex = 0, critical = 600 }`: per-tier caps; `0` means use `max_words`.
  - `mode = "soft" | "hard"` (default `soft`).
- **Per-task override**, like `tier=<t>`: the user says "this task: tone=verbose" (or `max_words=600`) and the router passes it to `saw task start --tone verbose --max-words 600`. It is stored in `.saw/task.json` and wins over the tier cap. `--set style.tone=...` still works for one command.
- **`saw style`** prints the effective style, e.g. `Style: normal, ≤250 words`. The router puts it in its one-line tier statement, and the AGENTS.md template carries the always-on rule (the global fragment).
- **`saw style-check`**, a Stop hook (`features.style_hook`, on by default): counts prose words in the last reply from the transcript. Over the cap, `soft` shows a warning; `hard` blocks once and asks for a rewrite within the cap (never twice in a row, via `stop_hook_active`).
- **Evals** `style-<tone>`: the same task under each tone stays within its cap and keeps the verification label.

## Out of scope
- Counting tokens instead of words. Words are what the user reads, and are cheap to count.
- Checking that a reply actually matches its tone. That's for the evals' LLM graders, not a hook.

## Not verified
- The transcript format isn't a documented API; the hook reads the assistant text blocks after the last user prompt and stays silent if it can't find any.
- The evals need `claude plugin eval` to run; they are not run in `bun test`.
