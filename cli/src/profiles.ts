// `saw profile`: the recommended settings in the Profiles section of docs/COMMANDS.md,
// merged key by key into the layer each block names. The doc's TOML blocks are
// the only copy, so the docs and the command can't drift apart.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { flatten, layerPaths, loosens, setPath, validate, type Layer } from "./config";
import type { Table, Value } from "./defaults";
import { parseToml, patchToml, readToml, stringifyToml } from "./toml";
import { readIfExists } from "./fs";

export type ProfileLayer = Exclude<Layer, "default" | "override" | `enforcement=${string}`>;

export interface Profile {
  name: string;
  title: string;
  blocks: { layer: ProfileLayer; values: Record<string, Value> }[];
}

const FILES: Record<string, ProfileLayer> = {
  "workflow.toml": "project",
  "workflow.local.toml": "local",
  "~/.saw/config.toml": "global",
};

// Each `## Name: ...` section; within it, a line starting with a backticked file
// name, then the next ```toml block, is one layer's settings.
export function parseProfiles(markdown: string): Profile[] {
  const profiles: Profile[] = [];
  let current: Profile | undefined;
  let layer: ProfileLayer | undefined;
  let block: string[] | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    if (block) {
      if (line.startsWith("```")) {
        if (current && layer) current.blocks.push({ layer, values: flatten(parseToml(block.join("\n"))) });
        block = undefined;
        layer = undefined;
      } else block.push(line);
      continue;
    }
    const h = /^## (\w+)(?::\s*(.*))?$/.exec(line);
    if (h) {
      current = { name: h[1]!.toLowerCase(), title: h[2] ?? "", blocks: [] };
      profiles.push(current);
      layer = undefined;
      continue;
    }
    const file = /^`([^`]+)`/.exec(line)?.[1];
    if (file && file in FILES) layer = FILES[file];
    else if (line.startsWith("```toml") && layer) block = [];
  }
  return profiles.filter((p) => p.blocks.length);
}

export interface ApplyResult {
  layer: ProfileLayer;
  path: string;
  set: string[];
  problems: string[];
}

// Merges each block into its file in place (comments survive where patchToml
// can place the key), so a table saw init already wrote is never redefined.
export function applyProfile(cwd: string, profile: Profile, dryRun = false, paths = layerPaths(cwd)): ApplyResult[] {
  return profile.blocks.map(({ layer, values }) => {
    const path = paths[layer];
    let text = readIfExists(path) ?? "";
    const table: Table = readToml(path) ?? {};
    const result: ApplyResult = { layer, path, set: [], problems: [] };
    for (const [key, value] of Object.entries(values)) {
      const problem = validate(key, value);
      if (problem) {
        result.problems.push(problem);
        continue;
      }
      if (layer === "project" && loosens(key, value)) {
        result.problems.push(`${key}: a committed workflow.toml can only tighten it; skipped`);
        continue;
      }
      setPath(table, key, value);
      text = patchToml(text, key, value, table) ?? stringifyToml(table);
      result.set.push(`${key} = ${JSON.stringify(value)}`);
    }
    if (!dryRun && result.set.length) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    }
    return result;
  });
}
