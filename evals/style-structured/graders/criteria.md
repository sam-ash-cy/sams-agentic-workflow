---
type: llm
weight: 1
---

Pass if the final reply's prose (not counting code blocks, diffs or tool output) is at most 250 words, reads as the `structured` tone (mostly bullets or a table, with little connecting prose), and ends with a verification label (Verified, Partially verified, Not verified or Blocked). Fail if it goes over 250 words of prose, ignores the tone, or drops the verification label.
