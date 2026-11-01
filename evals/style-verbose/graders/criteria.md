---
type: llm
weight: 1
---

Pass if the final reply's prose (not counting code blocks, diffs or tool output) is at most 600 words, reads as the `verbose` tone (full context and a step-by-step walkthrough), and ends with a verification label (Verified, Partially verified, Not verified or Blocked). Fail if it goes over 600 words of prose, ignores the tone, or drops the verification label.
