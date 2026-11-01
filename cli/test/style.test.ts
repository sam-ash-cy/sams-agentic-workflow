import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "../src/config";
import { effectiveStyle, lastReply, proseWords, styleCheck, styleLine } from "../src/style";
import { startTask } from "../src/task";
import { run } from "../src/main";

function setup(toml = ""): { dir: string; config: ReturnType<typeof resolve>["config"] } {
  const dir = mkdtempSync(join(tmpdir(), "saw-style-"));
  writeFileSync(join(dir, "workflow.toml"), toml);
  const none = join(dir, "none.toml");
  return { dir, config: resolve(dir, {}, { global: none, project: join(dir, "workflow.toml"), local: none }).config };
}

const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

function transcript(dir: string, reply: string[]): string {
  const path = join(dir, "t.jsonl");
  const lines = [
    { type: "user", message: { role: "user", content: "old prompt" } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: words(999) }] } },
    { type: "user", message: { role: "user", content: [{ type: "text", text: "new prompt" }] } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: reply[0] }, { type: "tool_use", name: "Bash" }] } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", content: words(500) }] } },
    ...reply.slice(1).map((text) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } })),
  ];
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n{partial");
  return path;
}

test("prose words skip code blocks, inline code and markdown punctuation", () => {
  const text = "Two words.\n\n```diff\n- a b c\n+ d e f\n```\n\n| a | b |\n|---|---|\n- run `saw run test` now\n~~~\nunclosed fence";
  expect(proseWords(text)).toBe(6);
});

test("cap precedence: task override > tier cap > max_words", () => {
  const { dir, config } = setup('[style]\nmax_words = 300\n');
  expect(effectiveStyle(config)).toEqual({ tone: "normal", maxWords: 300, mode: "soft" });
  expect(effectiveStyle(config, startTask(dir, "standard", "feature")).maxWords).toBe(300);
  expect(effectiveStyle(config, startTask(dir, "trivial", "feature")).maxWords).toBe(80);
  const t = startTask(dir, "critical", "feature", { tone: "verbose", max_words: 900 });
  expect(styleLine(effectiveStyle(config, t))).toBe("Style: verbose, ≤900 words");
});

test("the last reply is every assistant text after the latest user prompt", () => {
  const { dir } = setup();
  const reply = lastReply(transcript(dir, ["first part", "second part"]));
  expect(reply).toBe("first part\n\nsecond part");
  expect(lastReply(join(dir, "missing.jsonl"))).toBeUndefined();
});

test("soft mode warns over the cap and is silent under it", () => {
  const { dir, config } = setup();
  expect(styleCheck(dir, config, { transcript_path: transcript(dir, [words(200)]) })).toBeUndefined();
  const out = styleCheck(dir, config, { transcript_path: transcript(dir, [words(200), words(100)]) });
  expect(out?.systemMessage).toContain("300 words of prose; the cap is 250");
  expect(out?.decision).toBeUndefined();
});

test("hard mode blocks once for a rewrite, then lets the stop through", () => {
  const { dir, config } = setup('[style]\nmode = "hard"\n');
  const path = transcript(dir, [words(300)]);
  expect(styleCheck(dir, config, { transcript_path: path })).toMatchObject({ decision: "block" });
  expect(styleCheck(dir, config, { transcript_path: path, stop_hook_active: true })?.decision).toBeUndefined();
  expect(styleCheck(dir, config, { last_assistant_message: "short" })).toBeUndefined();
});

test("the feature flag turns the hook off", () => {
  const { dir, config } = setup("[features]\nstyle_hook = false\n");
  expect(styleCheck(dir, config, { last_assistant_message: words(1000) })).toBeUndefined();
});

test("saw task start validates and stores the per-task style", () => {
  const { dir } = setup();
  expect(run(["task", "start", "--tier", "standard", "--tone", "loud"], dir)).toBe(1);
  expect(run(["task", "start", "--tier", "standard", "--max-words", "0"], dir)).toBe(1);
  expect(run(["task", "start", "--tier", "standard", "--tone", "structured", "--max-words", "120"], dir)).toBe(0);
  expect(run(["config", "set", "style.tone", "loud"], dir)).toBe(1);
});
