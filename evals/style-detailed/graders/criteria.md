---
type: llm
weight: 1
---

Pass if the final reply's prose (not counting code blocks, diffs or tool output) is at most 400 words, reads as the `detailed` tone (the reasoning and at least one trade-off), and ends with a verification label (Verified, Partially verified, Not verified or Blocked). Fail if it goes over 400 words of prose, ignores the tone, or drops the verification label.
