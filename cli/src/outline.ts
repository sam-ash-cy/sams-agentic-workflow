// `saw outline <file>`: signatures only, with line numbers, so an agent can
// read a large file by range when Trail is off. Regex per language: good
// enough to locate code, not a parser.

import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";

// const/let only at the top level: inside a body they are locals, not API.
const TS = /^\s*(export\s+)?(default\s+)?(declare\s+)?(async\s+)?(function\*?|class|interface|type|enum|abstract\s+class)\s+[\w$]+|^(export\s+)?(const|let)\s+[\w$]+|^\s*(public|private|protected|static|async|get|set|readonly|\s)*[\w$]+\s*\([^)]*\)\s*(:\s*[^{=]+)?\s*\{\s*$/;

const PATTERNS: Record<string, RegExp> = {
  ".ts": TS,
  ".tsx": TS,
  ".js": TS,
  ".jsx": TS,
  ".mjs": TS,
  ".py": /^\s*(async\s+)?(def|class)\s+\w+/,
  ".php": /^\s*((abstract|final|public|private|protected|static|readonly)\s+)*(function|class|interface|trait|enum)\s+\w+/,
  ".go": /^(func|type)\s+/,
  ".rs": /^\s*(pub(\([\w:]+\))?\s+)?(async\s+)?(fn|struct|enum|trait|impl|mod|type)\b/,
  ".java": /^\s*((public|private|protected|static|final|abstract)\s+)+[\w<>[\], ]+\s+\w+\s*\(|^\s*((public|private|protected)\s+)?(class|interface|enum|record)\s+\w+/,
  ".cs": /^\s*((public|private|protected|internal|static|async|override|virtual)\s+)+[\w<>[\], ]+\s+\w+\s*\(|^\s*((public|internal)\s+)?(class|interface|enum|record|struct)\s+\w+/,
  ".rb": /^\s*(def|class|module)\s+/,
};

// Control-flow lines the method pattern would otherwise pick up.
const NOT_A_SIGNATURE = /^\s*(if|for|while|switch|catch|return|else)\b/;

export function outline(path: string): string[] {
  if (!existsSync(path)) throw new Error(`no such file: ${path}`);
  const re = PATTERNS[extname(path).toLowerCase()];
  if (!re) throw new Error(`no outline pattern for ${extname(path) || "this file type"}; read it by line range`);
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line, i) => [i + 1, line] as const)
    .filter(([, line]) => re.test(line) && !NOT_A_SIGNATURE.test(line))
    .map(([n, line]) => `${n}: ${line.trim().replace(/\s*\{\s*$/, "")}`);
}
