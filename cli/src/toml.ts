// TOML in and out with no dependencies: bun parses, this module serializes the
// subset saw writes (tables, strings, numbers, booleans, arrays of scalars).

import { existsSync, readFileSync } from "node:fs";
import type { Table, Value } from "./defaults";

export function parseToml(text: string): Table {
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
