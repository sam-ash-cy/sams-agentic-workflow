---
name: about-me
description: Use when the user asks to set up, fill in or update their "about me" profile, goals or working preferences, or when `saw about-me show` reports no answers and the user agrees to an interview. Interviews them (~50 questions in six groups) and writes the answers to the global or project about-me file.
---

# About-me interview

The profile is plain Markdown: `## section`, `### question`, the answer underneath. saw puts the merged answers in every session's context (`features.about_me`).

| Scope | File | Use for |
|---|---|---|
| global (default) | `~/.saw/about-me.md` | who the user is, across all projects |
| project | `docs/about-me.md` | this project's goals and rules; committed, so nothing personal |
| local | `.saw/about-me.local.md` | personal notes for this project; gitignored |

A project or local answer replaces the global answer to the same question.

## Steps

1. Ask which scope, unless the user said. Run `saw about-me --scope <scope>` to create the file from the template if it's missing.
2. Read the file. Answered questions are prefill: show the current answer and ask only whether it changed.
3. Go through the six sections in order. Ask one section at a time with AskUserQuestion: up to 4 questions per call, two calls per section, each with 2–4 likely answers (the user can always type their own). For open questions (what are you building, success in a month) ask in plain text instead. Every question is skippable; never push.
4. For the project scope, skip personal questions (role, experience, working week) and keep answers safe to commit: no names, emails, paths or secrets.
5. Write each answer under its question with Edit, in the user's words, one or two lines. Leave skipped questions blank. Don't reorder or delete questions the user didn't ask to remove.
6. Show `saw about-me show` and ask if anything reads wrong.
7. Suggest settings the answers imply (for example `saw config set autonomy.level act --scope global`, `style.tone`, `features.tdd`), as commands for the user to approve, not changes made silently.

Stop early whenever the user wants; partial profiles work.
