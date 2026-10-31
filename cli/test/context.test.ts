import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { contextHook, contextTokens, nudgeFor } from "../src/context";

function setup(toml = ""): { dir: string; config: ReturnType<typeof resolve>["config"]; transcript: (tokens: number) => string } {
  const dir = mkdtempSync(join(tmpdir(), "saw-ctx-"));
  writeFileSync(join(dir, "workflow.toml"), toml);
  const none = join(dir, "none.toml");
  const config = resolve(dir, {}, { global: none, project: join(dir, "workflow.toml"), local: none }).config;
  const transcript = (tokens: number): string => {
    const path = join(dir, "t.jsonl");
    const usage = { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: tokens - 10, output_tokens: 500 };
    writeFileSync(path, [JSON.stringify({ type: "user" }), JSON.stringify({ message: { usage } }), "{partial"].join("\n"));
    return path;
  };
  return { dir, config, transcript };
}

test("context size is the latest turn's prompt tokens, skipping a partial line", () => {
  const { transcript } = setup();
  expect(contextTokens(transcript(120000))).toBe(120000);
  expect(contextTokens("nope.jsonl")).toBeUndefined();
});

test("thresholds pick the highest one crossed that hasn't fired", () => {
  const { config } = setup();
  expect(nudgeFor(config, 90000, [])).toBeUndefined();
  expect(nudgeFor(config, 100000, [])?.share).toBe(0.5);
  expect(nudgeFor(config, 150000, [0.5])?.share).toBe(0.7);
  expect(nudgeFor(config, 150000, [0.5, 0.7])).toBeUndefined();
  expect(nudgeFor(config, 180000, [0.5, 0.7])).toMatchObject({ share: 0.85, level: "handoff" });
});

test("the hook fires once per threshold per session, and never twice for a skipped one", () => {
  const { dir, config, transcript } = setup();
  const s1 = { session_id: "a", transcript_path: transcript(110000) };
  const out = contextHook(dir, config, s1) as { systemMessage: string; hookSpecificOutput: { additionalContext: string } };
  expect(out.systemMessage).toContain("55% full");
  expect(out.hookSpecificOutput.additionalContext).toContain("/compact");
  expect(contextHook(dir, config, s1)).toBeUndefined();

  // A big jump goes straight to the handoff, and marks the skipped 70% as done.
  const jump = { session_id: "a", transcript_path: transcript(190000) };
  expect(contextHook(dir, config, jump)?.systemMessage).toContain("handoff");
  expect(contextHook(dir, config, { session_id: "a", transcript_path: transcript(150000) })).toBeUndefined();

  // A new session starts fresh.
  expect(contextHook(dir, config, { session_id: "b", transcript_path: transcript(110000) })).toBeDefined();
});

test("window size and the feature toggle are configurable", () => {
  const big = setup("[context]\nwindow_tokens = 1000000");
  expect(contextHook(big.dir, big.config, { session_id: "x", transcript_path: big.transcript(300000) })).toBeUndefined();
  const off = setup("[features]\ncompact_nudge = false");
  expect(contextHook(off.dir, off.config, { session_id: "x", transcript_path: off.transcript(190000) })).toBeUndefined();
});
