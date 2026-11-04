// TOML in and out with no dependencies: bun parses, this module serializes the
// subset saw writes (tables, strings, numbers, booleans, arrays of scalars).

import { existsSync, readFileSync } from "node:fs";
import type { Table, Value } from "./defaults";

// Bun's parser accepts a table header with no closing bracket (`[broken`) and
// drops it, so a broken settings file would load as if it were fine. Lines
// outside a multi-line value that open with `[` must be a whole header.
const HEADER = /^\[\[?\s*[\w"'.\s-]+\s*\]\]?\s*(#.*)?$/;

function checkHeaders(text: string): void {
  let depth = 0;
  let multiline: string | undefined;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (multiline) {
      if (line.includes(multiline)) multiline = undefined;
      return;
    }
    const triple = /("""|''')/.exec(line);
    if (triple && line.split(triple[1]!).length === 2) {
      multiline = triple[1];
      return;
    }
    if (depth === 0 && line.startsWith("[") && !HEADER.test(line)) throw new Error(`line ${i + 1}: bad table header: ${line.slice(0, 60)}`);
    if (depth === 0 && line.startsWith("[")) return;
    const bare = line.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, "").replace(/#.*/, "");
    depth = Math.max(0, depth + (bare.match(/\[/g)?.length ?? 0) - (bare.match(/\]/g)?.length ?? 0));
  });
}

export function parseToml(text: string): Table {
  checkHeaders(text);
  return Bun.TOML.parse(text) as Table;
}

export function readToml(path: string): Table | undefined {
  if (!existsSync(path)) return undefined;
  return parseToml(readFileSync(path, "utf8"));
}

function isTable(v: Value | undefined): v is Table {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function scalar(v: Value): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(scalar).join(", ")}]`;
  if (isTable(v)) {
    const parts = Object.entries(v).map(([k, x]) => `${k} = ${scalar(x)}`);
    return `{ ${parts.join(", ")} }`;
  }
  return String(v);
}

// Sets (or with undefined, removes) one dotted key in TOML text in place, so
// comments and layout survive `saw config set`. Returns undefined when the
// edit can't be made safely (inline tables, multi-line values); the caller
// then re-serialises the whole file.
export function patchToml(text: string, key: string, value: Value | undefined, expected: Table): string | undefined {
  const parts = key.split(".");
  const leaf = parts.pop()!;
  const section = parts.join(".");
  const lines = text.split(/\r?\n/);
  let current = "";
  let lastInSection = section === "" ? -1 : undefined as number | undefined;
  let firstHeader = lines.length;
  let hit: number | undefined;
  lines.forEach((line, i) => {
    const h = /^\s*\[([^\][]+)\]\s*(#.*)?$/.exec(line);
    if (h) {
      current = h[1]!.replace(/\s/g, "");
      firstHeader = Math.min(firstHeader, i);
      if (current === section) lastInSection = i;
      return;
    }
    if (current !== section) return;
    if (line.trim() && !line.trim().startsWith("#")) lastInSection = i;
    if (new RegExp(`^\\s*${leaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`).test(line)) hit = i;
  });
  const entry = value === undefined ? undefined : `${leaf} = ${scalar(value)}`;
  if (hit !== undefined) {
    if (entry === undefined) lines.splice(hit, 1);
    else lines[hit] = entry + (/\s+#[^"']*$/.exec(lines[hit]!)?.[0] ?? "");
  } else if (entry !== undefined) {
    if (lastInSection !== undefined && lastInSection >= 0) lines.splice(lastInSection + 1, 0, entry);
    else if (section === "") lines.splice(Math.min(firstHeader, lines.length), 0, entry);
    else lines.push(...(lines.at(-1)?.trim() ? [""] : []), `[${section}]`, entry);
  } else return undefined;
  // Keep the file's line endings, so a one-key change is a one-line diff.
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  let out = lines.join(eol);
  if (!out.endsWith(eol)) out += eol;
  try {
    return Bun.deepEquals(parseToml(out), expected) ? out : undefined;
  } catch {
    return undefined;
  }
}

export function stringifyToml(table: Table, prefix = ""): string {
  const lines: string[] = [];
  const subtables: [string, Table][] = [];
  for (const [key, value] of Object.entries(table)) {
    if (isTable(value)) subtables.push([key, value]);
    else lines.push(`${key} = ${scalar(value)}`);
  }
  let out = "";
  if (prefix && lines.length) out += `[${prefix}]\n`;
  if (lines.length) out += lines.join("\n") + "\n";
  for (const [key, sub] of subtables) {
    const body = stringifyToml(sub, prefix ? `${prefix}.${key}` : key);
    if (body) out += (out ? "\n" : "") + body;
  }
  return out;
}
